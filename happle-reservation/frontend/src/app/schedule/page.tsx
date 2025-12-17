'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSchedule, getProgram, ScheduleSlot, Program } from '@/lib/api'
import { format, parseISO, addDays, startOfDay, isSameDay } from 'date-fns'
import { ja } from 'date-fns/locale'

function ScheduleContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const programId = searchParams.get('program_id')
  const studioId = searchParams.get('studio_id')

  const [program, setProgram] = useState<Program | null>(null)
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([])
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 表示する日付の範囲（14日間）
  const dateRange = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(new Date()), i))

  useEffect(() => {
    async function loadData() {
      if (!programId) {
        setError('プログラムが選択されていません')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const [programData, scheduleData] = await Promise.all([
          getProgram(parseInt(programId)),
          getSchedule({
            program_id: parseInt(programId),
            studio_id: studioId ? parseInt(studioId) : undefined,
            start_date: format(new Date(), 'yyyy-MM-dd'),
            end_date: format(addDays(new Date(), 14), 'yyyy-MM-dd')
          })
        ])
        
        setProgram(programData)
        setSchedule(scheduleData)
      } catch (err) {
        setError('データの読み込みに失敗しました')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [programId, studioId])

  const handleSlotSelect = (slot: ScheduleSlot) => {
    if (!slot.is_reservable || slot.available <= 0) return
    
    const params = new URLSearchParams()
    params.set('slot_id', slot.id.toString())
    params.set('program_id', programId!)
    if (studioId) params.set('studio_id', studioId)
    router.push(`/booking?${params.toString()}`)
  }

  // 選択された日付のスロットをフィルタリング
  const filteredSlots = schedule.filter(slot => {
    const slotDate = parseISO(slot.start_at)
    return isSameDay(slotDate, selectedDate)
  }).sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">スケジュールを読み込み中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">😢</div>
          <p className="text-accent-600 mb-4">{error}</p>
          <button onClick={() => router.back()} className="btn-secondary">
            戻る
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-accent-600 hover:text-primary-600 mb-6 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        メニュー選択に戻る
      </button>

      {/* Program Info */}
      {program && (
        <div className="card mb-8 animate-fade-in">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-primary-200 rounded-xl flex items-center justify-center">
              <span className="text-3xl">🌿</span>
            </div>
            <div>
              <h2 className="font-display font-bold text-xl text-accent-900">{program.name}</h2>
              <div className="flex items-center gap-4 text-sm text-accent-500 mt-1">
                {program.duration && <span>{program.duration}分</span>}
                {program.price && <span className="text-primary-600 font-medium">¥{program.price.toLocaleString()}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Date Selection */}
      <section className="mb-8 animate-fade-in-delay-1">
        <h3 className="font-display text-lg font-bold text-accent-800 mb-4">
          日付を選択
        </h3>
        <div className="flex gap-2 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
          {dateRange.map((date) => {
            const isSelected = isSameDay(date, selectedDate)
            const isToday = isSameDay(date, new Date())
            const hasSlots = schedule.some(slot => isSameDay(parseISO(slot.start_at), date))
            
            return (
              <button
                key={date.toISOString()}
                onClick={() => setSelectedDate(date)}
                disabled={!hasSlots}
                className={`flex-shrink-0 w-16 py-3 rounded-xl text-center transition-all ${
                  isSelected
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25'
                    : hasSlots
                    ? 'bg-white text-accent-700 hover:bg-accent-50 shadow-sm'
                    : 'bg-accent-100 text-accent-400 cursor-not-allowed'
                }`}
              >
                <div className="text-xs mb-1">
                  {format(date, 'E', { locale: ja })}
                </div>
                <div className="text-lg font-bold">
                  {format(date, 'd')}
                </div>
                {isToday && (
                  <div className={`text-xs mt-1 ${isSelected ? 'text-white/80' : 'text-primary-500'}`}>
                    今日
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* Time Slots */}
      <section className="animate-fade-in-delay-2">
        <h3 className="font-display text-lg font-bold text-accent-800 mb-4">
          {format(selectedDate, 'M月d日(E)', { locale: ja })} の予約枠
        </h3>
        
        {filteredSlots.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-4xl mb-4">📅</div>
            <p className="text-accent-600">この日の予約枠はありません</p>
            <p className="text-sm text-accent-500 mt-2">別の日付を選択してください</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSlots.map((slot) => {
              const startTime = format(parseISO(slot.start_at), 'HH:mm')
              const endTime = format(parseISO(slot.end_at), 'HH:mm')
              const isAvailable = slot.is_reservable && slot.available > 0
              
              return (
                <button
                  key={slot.id}
                  onClick={() => handleSlotSelect(slot)}
                  disabled={!isAvailable}
                  className={`card text-left transition-all ${
                    isAvailable
                      ? 'card-hover border-2 border-transparent hover:border-primary-200'
                      : 'opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xl font-bold text-accent-900">
                      {startTime}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      isAvailable
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {isAvailable ? `残り${slot.available}枠` : '満席'}
                    </span>
                  </div>
                  <div className="text-sm text-accent-500">
                    {startTime} - {endTime}
                  </div>
                  {slot.instructor_name && (
                    <div className="text-sm text-accent-600 mt-2 flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      {slot.instructor_name}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default function SchedulePage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">読み込み中...</p>
        </div>
      </div>
    }>
      <ScheduleContent />
    </Suspense>
  )
}



