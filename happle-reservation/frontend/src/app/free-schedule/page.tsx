'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getChoiceSchedule, ChoiceSchedule } from '@/lib/api'
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
  const studioRoomId = searchParams.get('studio_room_id')
  const studioId = searchParams.get('studio_id')

  // 週の開始日（デフォルトは今週の日曜日、または今日を含む週）
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 })) // 月曜始まり
  const [weeklySchedules, setWeeklySchedules] = useState<(ChoiceSchedule | null)[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 1週間分の日付リスト
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))

  useEffect(() => {
    async function loadWeeklySchedule() {
      if (!studioRoomId) {
        setError('スタジオルームが指定されていません')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        // 7日分のスケジュールを並列で取得
        const promises = weekDates.map(date => 
          getChoiceSchedule(parseInt(studioRoomId), format(date, 'yyyy-MM-dd'))
        )
        const results = await Promise.all(promises)
        setWeeklySchedules(results)
      } catch (err) {
        setError('スケジュールの読み込みに失敗しました')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadWeeklySchedule()
  }, [studioRoomId, currentWeekStart])

  // グリッド生成ロジック
  const generateGrid = () => {
    // 営業時間の範囲を特定（デフォルト 9:00 - 21:00）
    let minStartHour = 9
    let maxEndHour = 21
    let interval = 30 // デフォルト30分刻み

    // 取得したデータから実際の営業時間と刻み幅を取得
    weeklySchedules.forEach(schedule => {
      if (schedule?.studio_room_service?.schedule_nick) {
        interval = schedule.studio_room_service.schedule_nick
      }
      schedule?.shift_studio_business_hour?.forEach(bh => {
        if (!bh.is_holiday) {
          const start = parseISO(bh.start_at).getHours()
          const end = parseISO(bh.end_at).getHours()
          if (start < minStartHour) minStartHour = start
          if (end > maxEndHour) maxEndHour = end + 1 // 余裕を持たせる
        }
      })
    })

    // タイム行の生成
    const rows = []
    let currentTime = new Date()
    currentTime.setHours(minStartHour, 0, 0, 0)
    const endTime = new Date()
    endTime.setHours(maxEndHour, 0, 0, 0)

    while (currentTime < endTime) {
      const timeLabel = format(currentTime, 'HH:mm')
      const rowSlots: GridSlot[] = []

      // 各日のスロットを生成
      weekDates.forEach((date, index) => {
        const schedule = weeklySchedules[index]
        let isAvailable = false
        let isHoliday = true

        if (schedule) {
          // 営業時間をチェック
          const businessHour = schedule.shift_studio_business_hour?.find(
            bh => !bh.is_holiday && isSameDay(parseISO(bh.date), date)
          )

          if (businessHour) {
            isHoliday = false
            const bhStart = parseISO(businessHour.start_at)
            const bhEnd = parseISO(businessHour.end_at)
            
            // 現在のセル時間が営業時間内か
            // 日付を合わせる
            const cellTime = new Date(date)
            cellTime.setHours(currentTime.getHours(), currentTime.getMinutes(), 0, 0)
            
            const cellEndTime = new Date(cellTime.getTime() + interval * 60000)

            if (cellTime >= bhStart && cellEndTime <= bhEnd) {
              // スタッフの空き状況をチェック
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

    const params = new URLSearchParams()
    params.set('studio_room_id', studioRoomId!)
    params.set('start_at', slot.startAt)
    if (studioId) params.set('studio_id', studioId)
    router.push(`/free-booking?${params.toString()}`)
  }

  const handlePrevWeek = () => setCurrentWeekStart(subWeeks(currentWeekStart, 1))
  const handleNextWeek = () => setCurrentWeekStart(addWeeks(currentWeekStart, 1))

  if (loading && weeklySchedules.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-4">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={() => router.back()} className="btn-secondary">戻る</button>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-2 py-6 sm:px-6">
      {/* Header & Navigation */}
      <div className="flex flex-col sm:flex-row items-center justify-between mb-6 gap-4">
        <h2 className="text-xl font-bold text-gray-800">ご希望の日時</h2>
        <div className="flex items-center gap-4 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
            <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-100 rounded-md transition-colors text-primary-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="font-bold text-lg min-w-[140px] text-center">
                {format(currentWeekStart, 'M/d')} 〜 {format(addDays(currentWeekStart, 6), 'M/d')}
            </span>
            <button onClick={handleNextWeek} className="p-2 hover:bg-gray-100 rounded-md transition-colors text-primary-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
        </div>
      </div>

      {/* Calendar Grid */}
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
      
      <div className="mt-8 text-center">
        <button onClick={() => router.push('/')} className="text-primary-600 hover:underline text-sm">
            メニュー選択に戻る
        </button>
      </div>
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
