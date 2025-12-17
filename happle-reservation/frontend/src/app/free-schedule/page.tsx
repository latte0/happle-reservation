'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { sendGTMEvent } from '@next/third-parties/google'
import { getChoiceSchedule, getStudios, getPrograms, getStudioRooms, ChoiceSchedule, Studio, Program, StudioRoom } from '@/lib/api'
import { format, addDays, startOfWeek, subWeeks, addWeeks, parseISO, isSameDay } from 'date-fns'
import { ja } from 'date-fns/locale'

// タイムスロットの型定義
interface GridSlot {
  date: Date
  time: string
  startAt: string
  available: boolean
  isHoliday: boolean
}

function FreeScheduleContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialStudioId = searchParams.get('studio_id')
  const initialProgramId = searchParams.get('program_id')
  
  // UTMパラメータを保持
  const utmSource = searchParams.get('utm_source')
  const utmMedium = searchParams.get('utm_medium')
  const utmCampaign = searchParams.get('utm_campaign')

  // State for Selection Flow
  const [studios, setStudios] = useState<Studio[]>([])
  const [selectedStudio, setSelectedStudio] = useState<Studio | null>(null)
  
  const [programs, setPrograms] = useState<Program[]>([])
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null)
  
  const [studioRoomId, setStudioRoomId] = useState<number | null>(null)

  // Calendar State
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [weeklySchedules, setWeeklySchedules] = useState<(ChoiceSchedule | null)[]>([])
  const [loading, setLoading] = useState(true)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 1週間分の日付リスト
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))

  // 1. Load Studios
  useEffect(() => {
    async function loadStudios() {
      try {
        const data = await getStudios()
        setStudios(data)
        
        // Initial Selection Logic
        if (initialStudioId) {
            const initial = data.find(s => s.id === parseInt(initialStudioId))
            if (initial) handleStudioSelect(initial)
        } else if (data.length === 1) {
            handleStudioSelect(data[0])
        }
      } catch (err) {
        console.error(err)
        setError('店舗情報の読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }
    loadStudios()
  }, [])

  // 2. Handle Studio Selection -> Load Programs & Find Room
  const handleStudioSelect = async (studio: Studio) => {
    setSelectedStudio(studio)
    setSelectedProgram(null)
    setStudioRoomId(null)
    setWeeklySchedules([])
    
    try {
        // Load Programs
        const programsData = await getPrograms(studio.id)
        setPrograms(programsData)
        
        // URLパラメータでプログラムが指定されている場合は自動選択
        if (initialProgramId) {
          const initialProgram = programsData.find(p => p.id === parseInt(initialProgramId))
          if (initialProgram) {
            setSelectedProgram(initialProgram)
          }
        }
        
        // Load Rooms & Find Choice Room
        const roomsData = await getStudioRooms(studio.id)
        // Find a room that supports choice reservation (simplified logic: usually reservation_type='CHOICE' but API might not return it directly here)
        // For now, we assume if it's not the fixed lesson room (id=5), it might be the choice room.
        // Or better, checking reservation_type if available. 
        // Based on previous context: Test Room (id=3) is Choice. Pilates Room (id=5) is Fixed.
        // Let's pick the first one that is NOT id=5 for now, or just pick the first one if we can't distinguish.
        // Ideally the API response for StudioRoom should include reservation_type.
        
        // 仮ロジック: 固定枠(ID:5)以外を選択、または名前で判断
        const choiceRoom = roomsData.find(r => r.name.includes('Test') || r.id !== 5) || roomsData[0]
        
        if (choiceRoom) {
            setStudioRoomId(choiceRoom.id)
        } else {
            setError('予約可能な部屋が見つかりませんでした')
        }

    } catch (err) {
        console.error(err)
        setError('メニューの読み込みに失敗しました')
    }
  }

  // 3. Handle Program Selection -> Trigger Calendar Load
  const handleProgramSelect = (program: Program) => {
      setSelectedProgram(program)
  }

  // 4. Load Schedule when Room & Program are ready
  useEffect(() => {
    if (!studioRoomId || !selectedProgram) return

    async function loadWeeklySchedule() {
      try {
        setScheduleLoading(true)
        const promises = weekDates.map(date => 
          getChoiceSchedule(studioRoomId!, format(date, 'yyyy-MM-dd'))
        )
        const results = await Promise.all(promises)
        setWeeklySchedules(results)
      } catch (err) {
        console.error(err)
        // Don't set global error to avoid blocking UI, just show empty calendar
      } finally {
        setScheduleLoading(false)
      }
    }
    loadWeeklySchedule()
  }, [studioRoomId, selectedProgram, currentWeekStart])


  // Grid Generation Logic (Same as before)
  const generateGrid = () => {
    if (!weeklySchedules.length) return []

    let minStartHour = 9
    let maxEndHour = 21
    let interval = 30

    weeklySchedules.forEach(schedule => {
      if (schedule?.studio_room_service?.schedule_nick) {
        interval = schedule.studio_room_service.schedule_nick
      }
      schedule?.shift_studio_business_hour?.forEach(bh => {
        if (!bh.is_holiday) {
          const start = parseISO(bh.start_at).getHours()
          const end = parseISO(bh.end_at).getHours()
          if (start < minStartHour) minStartHour = start
          if (end > maxEndHour) maxEndHour = end + 1
        }
      })
    })

    const rows = []
    let currentTime = new Date()
    currentTime.setHours(minStartHour, 0, 0, 0)
    const endTime = new Date()
    endTime.setHours(maxEndHour, 0, 0, 0)

    while (currentTime < endTime) {
      const timeLabel = format(currentTime, 'HH:mm')
      const rowSlots: GridSlot[] = []

      weekDates.forEach((date, index) => {
        const schedule = weeklySchedules[index]
        let isAvailable = false
        let isHoliday = true

        if (schedule) {
          const businessHour = schedule.shift_studio_business_hour?.find(
            bh => !bh.is_holiday && isSameDay(parseISO(bh.date), date)
          )

          if (businessHour) {
            isHoliday = false
            const bhStart = parseISO(businessHour.start_at)
            const bhEnd = parseISO(businessHour.end_at)
            
            const cellTime = new Date(date)
            cellTime.setHours(currentTime.getHours(), currentTime.getMinutes(), 0, 0)
            const cellEndTime = new Date(cellTime.getTime() + interval * 60000)

            if (cellTime >= bhStart && cellEndTime <= bhEnd) {
              const shiftInstructors = schedule.shift_instructor || []
              const reservedSlots = schedule.reservation_assign_instructor || []
              
              let availableCount = 0
              for (const instructor of shiftInstructors) {
                  const instStart = parseISO(instructor.start_at)
                  const instEnd = parseISO(instructor.end_at)
                  if (cellTime >= instStart && cellEndTime <= instEnd) {
                      const isReserved = reservedSlots.some(res => 
                          res.entity_id === instructor.instructor_id &&
                          parseISO(res.start_at) < cellEndTime &&
                          parseISO(res.end_at) > cellTime
                      )
                      if (!isReserved) availableCount++
                  }
              }
              isAvailable = availableCount > 0
            }
          }
        }

        rowSlots.push({
          date: date,
          time: timeLabel,
          startAt: `${format(date, 'yyyy-MM-dd')} ${timeLabel}:00.000`,
          available: isAvailable,
          isHoliday: isHoliday
        })
      })

      rows.push({ time: timeLabel, slots: rowSlots })
      currentTime = new Date(currentTime.getTime() + interval * 60000)
    }
    
    return rows
  }

  const gridRows = generateGrid()

  const handleSlotSelect = (slot: GridSlot) => {
    if (!slot.available) return

    // GTMイベント: 自由枠日時選択
    sendGTMEvent({
      event: 'slot_select',
      reservation_type: 'free',
      studio_id: selectedStudio?.id,
      studio_name: selectedStudio?.name || '',
      program_id: selectedProgram?.id,
      program_name: selectedProgram?.name || '',
      slot_date: format(slot.date, 'yyyy-MM-dd'),
      slot_time: slot.time,
    })

    const params = new URLSearchParams()
    params.set('studio_room_id', studioRoomId!.toString())
    params.set('start_at', slot.startAt)
    if (selectedStudio) params.set('studio_id', selectedStudio.id.toString())
    if (selectedProgram) params.set('program_id', selectedProgram.id.toString())
    
    // UTMパラメータを引き継ぎ
    if (utmSource) params.set('utm_source', utmSource)
    if (utmMedium) params.set('utm_medium', utmMedium)
    if (utmCampaign) params.set('utm_campaign', utmCampaign)
    
    router.push(`/free-booking?${params.toString()}`)
  }

  const handlePrevWeek = () => setCurrentWeekStart(subWeeks(currentWeekStart, 1))
  const handleNextWeek = () => setCurrentWeekStart(addWeeks(currentWeekStart, 1))

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-2 py-6 sm:px-6">
      {/* Steps Indicator - Step 1 */}
      <div className="flex items-center justify-center mb-10 text-sm font-medium text-accent-400">
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center font-bold">1</div>
          <span className="ml-2 text-primary-700 font-bold">日時選択</span>
        </div>
        <div className="w-12 h-0.5 bg-gray-200 mx-4"></div>
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold">2</div>
          <span className="ml-2">お客様情報</span>
        </div>
        <div className="w-12 h-0.5 bg-gray-200 mx-4"></div>
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold">3</div>
          <span className="ml-2">確認</span>
        </div>
      </div>

      {/* Selection Area */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Studio Selection */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ご希望の店舗 <span className="text-red-500">*</span></label>
                <select 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    value={selectedStudio?.id || ''}
                    onChange={(e) => {
                        const studio = studios.find(s => s.id === parseInt(e.target.value))
                        if (studio) handleStudioSelect(studio)
                    }}
                >
                    <option value="">店舗を選択してください</option>
                    {studios.map(studio => (
                        <option key={studio.id} value={studio.id}>{studio.name}</option>
                    ))}
                </select>
            </div>

            {/* Program Selection */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ご希望のコース <span className="text-red-500">*</span></label>
                <select 
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
                    value={selectedProgram?.id || ''}
                    onChange={(e) => {
                        const program = programs.find(p => p.id === parseInt(e.target.value))
                        if (program) handleProgramSelect(program)
                    }}
                    disabled={!selectedStudio}
                >
                    <option value="">コースを選択してください</option>
                    {programs.map(program => (
                        <option key={program.id} value={program.id}>
                            {program.name} ({program.duration}分 / ¥{program.price?.toLocaleString()})
                        </option>
                    ))}
                </select>
            </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6">
            {error}
        </div>
      )}

      {/* Calendar Area */}
      {selectedStudio && selectedProgram && (
        <div className="animate-fade-in">
            {/* Header & Navigation */}
            <div className="flex flex-col sm:flex-row items-center justify-between mb-4 gap-4">
                <h3 className="text-lg font-bold text-gray-800">ご希望の日時 <span className="text-red-500 text-sm font-normal ml-1">*</span></h3>
                <div className="flex items-center gap-4 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
                    <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-100 rounded-md transition-colors text-primary-600">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="font-bold text-base min-w-[120px] text-center">
                        {format(currentWeekStart, 'M/d')} 〜 {format(addDays(currentWeekStart, 6), 'M/d')}
                    </span>
                    <button onClick={handleNextWeek} className="p-2 hover:bg-gray-100 rounded-md transition-colors text-primary-600">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>

            {/* Calendar Grid */}
            {scheduleLoading ? (
                <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                    <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] border-collapse">
                        <thead>
                        <tr>
                            <th className="p-3 border-b border-gray-200 bg-gray-50 text-gray-500 text-xs font-bold uppercase w-16 sticky left-0 z-10">
                            時間
                            </th>
                            {weekDates.map((date) => {
                            const isToday = isSameDay(date, new Date())
                            return (
                                <th key={date.toISOString()} className={`p-3 border-b border-gray-200 text-center min-w-[80px] ${isToday ? 'bg-primary-50' : 'bg-gray-50'}`}>
                                <div className={`text-xs font-bold mb-1 ${isToday ? 'text-primary-600' : 'text-gray-500'}`}>
                                    {format(date, 'M/d')}
                                </div>
                                <div className={`text-sm font-bold ${isToday ? 'text-primary-700' : 'text-gray-800'}`}>
                                    {format(date, 'E', { locale: ja })}
                                </div>
                                </th>
                            )
                            })}
                        </tr>
                        </thead>
                        <tbody>
                        {gridRows.map((row) => (
                            <tr key={row.time} className="hover:bg-gray-50 transition-colors">
                            <td className="p-2 border-b border-r border-gray-100 text-center text-xs font-bold text-gray-500 sticky left-0 bg-white z-10">
                                {row.time}
                            </td>
                            {row.slots.map((slot) => {
                                let content = <span className="text-gray-300 text-xl">×</span>
                                let cellClass = "cursor-not-allowed bg-gray-50/50"
                                
                                if (slot.available) {
                                    content = <span className="text-primary-500 text-xl font-bold">◎</span>
                                    cellClass = "cursor-pointer hover:bg-primary-50 active:bg-primary-100"
                                } else if (slot.isHoliday) {
                                    content = <span className="text-gray-200 text-sm">-</span>
                                    cellClass = "bg-gray-100/50"
                                }

                                return (
                                    <td
                                        key={slot.startAt}
                                        onClick={() => handleSlotSelect(slot)}
                                        className={`p-2 border-b border-r border-gray-100 text-center transition-all h-12 ${cellClass}`}
                                    >
                                        {content}
                                    </td>
                                )
                            })}
                            </tr>
                        ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}
            
            {/* Legend */}
            <div className="mt-4 flex gap-6 justify-center text-sm text-gray-600">
                <div className="flex items-center gap-2">
                    <span className="text-primary-500 font-bold text-lg">◎</span> 予約可能
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-gray-300 text-lg">×</span> 予約不可/満席
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-gray-400">-</span> 営業時間外
                </div>
            </div>
        </div>
      )}
      
      {!selectedProgram && !loading && (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300 mt-6">
              <p className="text-gray-500">店舗とコースを選択すると、予約可能な日時が表示されます</p>
          </div>
      )}
    </div>
  )
}

export default function FreeSchedulePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <FreeScheduleContent />
    </Suspense>
  )
}
