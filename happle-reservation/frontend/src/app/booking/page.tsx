'use client'

import { useEffect, useState, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { sendGTMEvent } from '@next/third-parties/google'
import { getProgram, getSchedule, createReservation, Program, ScheduleSlot } from '@/lib/api'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'

interface FormData {
  name: string
  nameKana: string
  email: string
  phone: string
  note: string
}

interface FormErrors {
  name?: string
  email?: string
  phone?: string
}

function BookingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const slotId = searchParams.get('slot_id')
  const programId = searchParams.get('program_id')
  const studioId = searchParams.get('studio_id')

  const [program, setProgram] = useState<Program | null>(null)
  const [slot, setSlot] = useState<ScheduleSlot | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState<FormData>({
    name: '',
    nameKana: '',
    email: '',
    phone: '',
    note: ''
  })
  const [formErrors, setFormErrors] = useState<FormErrors>({})

  useEffect(() => {
    async function loadData() {
      if (!slotId || !programId) {
        setError('予約情報が不足しています')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const [programData, scheduleData] = await Promise.all([
          getProgram(parseInt(programId)),
          getSchedule({
            program_id: parseInt(programId),
            studio_id: studioId ? parseInt(studioId) : undefined
          })
        ])
        
        setProgram(programData)
        const selectedSlot = scheduleData.find(s => s.id === parseInt(slotId))
        setSlot(selectedSlot || null)
        
        if (!selectedSlot) {
          setError('指定された予約枠が見つかりません')
        }
      } catch (err) {
        setError('データの読み込みに失敗しました')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [slotId, programId, studioId])

  // GTMイベント: フォーム表示
  const formStartSent = useRef(false)
  useEffect(() => {
    if (!loading && slot && program && !formStartSent.current) {
      formStartSent.current = true
      sendGTMEvent({
        event: 'form_start',
        slot_id: slot.id,
        program_id: program.id,
        program_name: program.name,
        studio_id: studioId,
        slot_date: format(parseISO(slot.start_at), 'yyyy-MM-dd'),
        slot_time: format(parseISO(slot.start_at), 'HH:mm'),
      })
    }
  }, [loading, slot, program, studioId])

  const validateForm = (): boolean => {
    const errors: FormErrors = {}
    
    if (!formData.name.trim()) {
      errors.name = 'お名前を入力してください'
    }
    
    if (!formData.email.trim()) {
      errors.email = 'メールアドレスを入力してください'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = '正しいメールアドレスを入力してください'
    }
    
    if (!formData.phone.trim()) {
      errors.phone = '電話番号を入力してください'
    } else if (!/^[\d-]{10,}$/.test(formData.phone.replace(/\s/g, ''))) {
      errors.phone = '正しい電話番号を入力してください'
    }
    
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm() || !slot) return
    
    // GTMイベント: フォーム送信
    sendGTMEvent({
      event: 'form_submit',
      slot_id: slot.id,
      program_id: program?.id,
      program_name: program?.name || '',
      studio_id: studioId,
    })
    
    setSubmitting(true)
    setError(null)
    
    try {
      const result = await createReservation({
        studio_lesson_id: slot.id,
        guest_name: formData.name,
        guest_name_kana: formData.nameKana,
        guest_email: formData.email,
        guest_phone: formData.phone,
        guest_note: formData.note,
        studio_id: studioId ? parseInt(studioId) : undefined
      })
      
      if (result.success && result.reservation) {
        const params = new URLSearchParams()
        params.set('reservation_id', result.reservation.id.toString())
        params.set('member_id', result.reservation.member_id.toString())
        if (result.verify) params.set('verify', result.verify)
        params.set('name', formData.name)
        params.set('email', formData.email)
        router.push(`/complete?${params.toString()}`)
      } else {
        setError(result.message || '予約に失敗しました')
      }
    } catch (err) {
      setError('予約処理中にエラーが発生しました')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    // Clear error when user starts typing
    if (formErrors[name as keyof FormErrors]) {
      setFormErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">読み込み中...</p>
        </div>
      </div>
    )
  }

  if (error && !slot) {
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
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-accent-600 hover:text-primary-600 mb-6 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        日時選択に戻る
      </button>

      {/* Reservation Summary */}
      {program && slot && (
        <div className="card mb-8 animate-fade-in">
          <h2 className="font-display font-bold text-lg text-accent-800 mb-4">
            ご予約内容
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-100 to-primary-200 rounded-lg flex items-center justify-center">
                <span className="text-xl">🌿</span>
              </div>
              <div>
                <div className="font-medium text-accent-900">{program.name}</div>
                <div className="text-sm text-accent-500">
                  {program.duration}分 / ¥{program.price?.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-3 border-t border-accent-100">
              <div className="w-10 h-10 bg-accent-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-accent-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <div className="font-medium text-accent-900">
                  {format(parseISO(slot.start_at), 'yyyy年M月d日(E)', { locale: ja })}
                </div>
                <div className="text-sm text-accent-500">
                  {format(parseISO(slot.start_at), 'HH:mm')} - {format(parseISO(slot.end_at), 'HH:mm')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Booking Form */}
      <form onSubmit={handleSubmit} className="card animate-fade-in-delay-1">
        <h2 className="font-display font-bold text-lg text-accent-800 mb-6">
          お客様情報
        </h2>
        
        <div className="space-y-5">
          {/* Name */}
          <div>
            <label htmlFor="name" className="label">
              お名前 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className={`input-field ${formErrors.name ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
              placeholder="山田 太郎"
            />
            {formErrors.name && (
              <p className="text-sm text-red-500 mt-1">{formErrors.name}</p>
            )}
          </div>

          {/* Name Kana */}
          <div>
            <label htmlFor="nameKana" className="label">
              お名前（フリガナ）
            </label>
            <input
              type="text"
              id="nameKana"
              name="nameKana"
              value={formData.nameKana}
              onChange={handleInputChange}
              className="input-field"
              placeholder="ヤマダ タロウ"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="label">
              メールアドレス <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              className={`input-field ${formErrors.email ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
              placeholder="example@email.com"
            />
            {formErrors.email && (
              <p className="text-sm text-red-500 mt-1">{formErrors.email}</p>
            )}
            <p className="text-xs text-accent-500 mt-1">
              予約確認メールをお送りします
            </p>
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="label">
              電話番号 <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone}
              onChange={handleInputChange}
              className={`input-field ${formErrors.phone ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
              placeholder="090-1234-5678"
            />
            {formErrors.phone && (
              <p className="text-sm text-red-500 mt-1">{formErrors.phone}</p>
            )}
          </div>

          {/* Note */}
          <div>
            <label htmlFor="note" className="label">
              備考
            </label>
            <textarea
              id="note"
              name="note"
              value={formData.note}
              onChange={handleInputChange}
              className="input-field min-h-[100px] resize-none"
              placeholder="ご要望やご質問があればご記入ください"
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <div className="mt-8">
          <button
            type="submit"
            disabled={submitting}
            className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                予約処理中...
              </>
            ) : (
              '予約を確定する'
            )}
          </button>
          <p className="text-xs text-accent-500 text-center mt-3">
            「予約を確定する」をクリックすると、入力されたメールアドレスに確認メールが送信されます
          </p>
        </div>
      </form>
    </div>
  )
}

export default function BookingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">読み込み中...</p>
        </div>
      </div>
    }>
      <BookingContent />
    </Suspense>
  )
}



