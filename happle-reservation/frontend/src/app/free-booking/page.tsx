'use client'

import { useEffect, useState, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { sendGTMEvent } from '@next/third-parties/google'
import { createChoiceReservation, getPrograms, Program, isProgramFullyConfigured } from '@/lib/api'
import { format, parse } from 'date-fns'
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
  nameKana?: string
  email?: string
  phone?: string
}

function FreeBookingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const studioRoomId = searchParams.get('studio_room_id')
  const startAt = searchParams.get('start_at')
  const dateStr = searchParams.get('date') // Optional: might be parsed from startAt
  const timeStr = searchParams.get('time') // Optional
  const studioId = searchParams.get('studio_id')
  const programIdParam = searchParams.get('program_id')
  
  // UTMパラメータを取得
  const utmSource = searchParams.get('utm_source')
  const utmMedium = searchParams.get('utm_medium')
  const utmCampaign = searchParams.get('utm_campaign')
  
  // LINE公式アカウントURL
  const lineUrl = searchParams.get('line_url')
  
  // 店舗連絡先情報
  const studioZip = searchParams.get('studio_zip')
  const studioAddress = searchParams.get('studio_address')
  const studioTel = searchParams.get('studio_tel')
  const studioUrl = searchParams.get('studio_url')
  const studioEmail = searchParams.get('studio_email')
  
  // 支払い方法
  const paymentType = searchParams.get('payment_type') as 'credit_card' | 'credit_card_cash' | null

  // Derive date and time from startAt if not provided explicitly
  const parsedStartAt = startAt ? parse(startAt, 'yyyy-MM-dd HH:mm:ss.SSS', new Date()) : null
  const displayDateStr = dateStr || (parsedStartAt ? format(parsedStartAt, 'yyyy-MM-dd') : '')
  const displayTimeStr = timeStr || (parsedStartAt ? format(parsedStartAt, 'HH:mm') : '')

  const [programs, setPrograms] = useState<Program[]>([])
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Confirmation mode state
  const [isConfirming, setIsConfirming] = useState(false)
  
  // 支払い方法確認チェック状態
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  
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
      if (!studioRoomId || !startAt) {
        setError('予約情報が不足しています')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        // プログラム一覧を取得（スタッフと設備の両方が紐づいているプログラムのみ）
        const programsData = await getPrograms({
          studioId: studioId ? parseInt(studioId) : undefined,
          filterFullyConfigured: true
        })
        setPrograms(programsData)
        // URLパラメータでプログラムが指定されていればそれを選択、なければ最初のプログラムを選択
        if (programIdParam) {
          const targetProgram = programsData.find(p => p.id === parseInt(programIdParam))
          if (targetProgram) {
            setSelectedProgram(targetProgram)
          } else if (programsData.length > 0) {
            setSelectedProgram(programsData[0])
          }
        } else if (programsData.length > 0) {
          setSelectedProgram(programsData[0])
        }
      } catch (err) {
        setError('データの読み込みに失敗しました')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [studioRoomId, startAt, studioId])

  // GTMイベント: フォーム表示
  const formStartSent = useRef(false)
  useEffect(() => {
    if (!loading && !formStartSent.current && studioRoomId && startAt) {
      formStartSent.current = true
      sendGTMEvent({
        event: 'form_start',
        reservation_type: 'free',
        studio_room_id: studioRoomId,
        studio_id: studioId,
        program_id: selectedProgram?.id,
        program_name: selectedProgram?.name || '',
        slot_date: displayDateStr,
        slot_time: displayTimeStr,
      })
    }
  }, [loading, studioRoomId, startAt, studioId, selectedProgram, displayDateStr, displayTimeStr])

  const validateForm = (): boolean => {
    const errors: FormErrors = {}
    
    if (!formData.name.trim()) {
      errors.name = 'お名前を入力してください'
    }
    
    if (!formData.nameKana.trim()) {
      errors.nameKana = 'フリガナを入力してください'
    }
    
    if (!formData.email.trim()) {
      errors.email = 'メールアドレスを入力してください'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = '正しいメールアドレスを入力してください'
    }
    
    if (!formData.phone.trim()) {
      errors.phone = '電話番号を入力してください'
    } else {
      // ハイフンとスペースを除去して数字のみにする
      const phoneDigits = formData.phone.replace(/[-\s]/g, '')
      if (!/^\d{10,11}$/.test(phoneDigits)) {
        errors.phone = '電話番号は10〜11桁の半角数字で入力してください（例: 09012345678）'
      }
    }
    
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // フォーム送信（確認画面へ）
  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault()
    if (validateForm()) {
      setIsConfirming(true)
      window.scrollTo(0, 0)
    }
  }

  // 修正する（入力画面へ戻る）
  const handleEdit = () => {
    setError(null) // エラーメッセージをクリア
    setIsConfirming(false)
    window.scrollTo(0, 0)
  }

  // 予約確定
  const handleSubmit = async () => {
    if (!selectedProgram || !studioRoomId || !startAt) return
    
    // GTMイベント: フォーム送信
    sendGTMEvent({
      event: 'form_submit',
      reservation_type: 'free',
      studio_room_id: studioRoomId,
      studio_id: studioId,
      program_id: selectedProgram.id,
      program_name: selectedProgram.name,
      slot_date: displayDateStr,
      slot_time: displayTimeStr,
    })
    
    setSubmitting(true)
    setError(null)
    
    try {
      const result = await createChoiceReservation({
        studio_room_id: parseInt(studioRoomId),
        program_id: selectedProgram.id,
        start_at: startAt,
        guest_name: formData.name,
        guest_name_kana: formData.nameKana,
        guest_email: formData.email,
        guest_phone: formData.phone,
        guest_note: formData.note,
        studio_id: studioId ? parseInt(studioId) : undefined,
        line_url: lineUrl || undefined,
        studio_zip: studioZip || undefined,
        studio_address: studioAddress || undefined,
        studio_tel: studioTel || undefined,
        studio_url: studioUrl || undefined,
        studio_email: studioEmail || undefined
      })
      
      if (result.success && result.reservation) {
        const params = new URLSearchParams()
        params.set('reservation_id', result.reservation.id.toString())
        params.set('member_id', result.reservation.member_id.toString())
        if (result.verify) params.set('verify', result.verify)
        params.set('name', formData.name)
        params.set('email', formData.email)
        params.set('type', 'free')
        params.set('studio_id', studioId || '')
        params.set('program_id', selectedProgram.id.toString())
        params.set('program_name', selectedProgram.name)
        params.set('reservation_date', displayDateStr)
        params.set('reservation_time', displayTimeStr)
        params.set('duration', selectedProgram.duration?.toString() || '')
        params.set('price', selectedProgram.price?.toString() || '')
        
        // UTMパラメータを引き継ぎ
        if (utmSource) params.set('utm_source', utmSource)
        if (utmMedium) params.set('utm_medium', utmMedium)
        if (utmCampaign) params.set('utm_campaign', utmCampaign)
        
        // LINE URLを引き継ぎ
        if (lineUrl) params.set('line_url', lineUrl)
        
        // 店舗連絡先情報を引き継ぎ
        if (studioZip) params.set('studio_zip', studioZip)
        if (studioAddress) params.set('studio_address', studioAddress)
        if (studioTel) params.set('studio_tel', studioTel)
        if (studioUrl) params.set('studio_url', studioUrl)
        if (studioEmail) params.set('studio_email', studioEmail)
        
        router.push(`/complete?${params.toString()}`)
      } else {
        // APIからのエラーメッセージを使用、なければデフォルトメッセージ
        const errorMessage = result.message || result.error || '予約処理中にエラーが発生しました。お客様の情報は受け付けておりますので、運営よりお電話にてご連絡させていただきます。'
        setError(errorMessage)
        // 確認画面に留まってエラーを表示
      }
    } catch (err) {
      setError('予約処理中にエラーが発生しました。お客様の情報は受け付けておりますので、運営よりお電話にてご連絡させていただきます。')
      console.error(err)
      // 確認画面に留まってエラーを表示
    } finally {
      setSubmitting(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (formErrors[name as keyof FormErrors]) {
      setFormErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  // 日時のフォーマット
  const formattedDate = displayDateStr 
    ? format(parse(displayDateStr, 'yyyy-MM-dd', new Date()), 'yyyy年M月d日(E)', { locale: ja })
    : ''

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

  if (error && !selectedProgram) {
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
      {/* Steps Indicator */}
      <div className="flex items-center justify-center mb-8 text-sm font-medium text-accent-400">
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold">1</div>
          <span className="ml-2 text-accent-900">日時選択</span>
        </div>
        <div className="w-12 h-0.5 bg-gray-200 mx-4"></div>
        <div className="flex items-center">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${!isConfirming ? 'bg-primary-600 text-white' : 'bg-primary-100 text-primary-600'}`}>2</div>
          <span className={`ml-2 ${!isConfirming ? 'text-primary-700 font-bold' : 'text-accent-900'}`}>お客様情報</span>
        </div>
        <div className="w-12 h-0.5 bg-gray-200 mx-4"></div>
        <div className="flex items-center">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${isConfirming ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-400'}`}>3</div>
          <span className={`ml-2 ${isConfirming ? 'text-primary-700 font-bold' : ''}`}>確認</span>
        </div>
      </div>

      {isConfirming ? (
        // Confirmation View
        <div className="animate-fade-in">
          <h2 className="text-2xl font-bold text-center text-accent-900 mb-8">
            予約内容の確認
          </h2>
          
          <div className="card mb-6 space-y-6">
            <div>
              <h3 className="text-sm font-bold text-accent-500 mb-2">ご希望の日時</h3>
              <div className="text-lg font-bold text-accent-900">
                {formattedDate} {displayTimeStr}
              </div>
            </div>
            
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-bold text-accent-500 mb-2">メニュー</h3>
              <div className="text-lg font-bold text-accent-900">
                {selectedProgram?.name}
              </div>
              <div className="text-accent-600 mt-1">
                {selectedProgram?.service_minutes || selectedProgram?.duration || '?'}分
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-bold text-accent-500 mb-2">お客様情報</h3>
              <dl className="space-y-2 text-accent-900">
                <div className="flex">
                  <dt className="w-32 text-accent-600">お名前</dt>
                  <dd>{formData.name}</dd>
                </div>
                <div className="flex">
                  <dt className="w-32 text-accent-600">フリガナ</dt>
                  <dd>{formData.nameKana || '-'}</dd>
                </div>
                <div className="flex">
                  <dt className="w-32 text-accent-600">メールアドレス</dt>
                  <dd>{formData.email}</dd>
                </div>
                <div className="flex">
                  <dt className="w-32 text-accent-600">電話番号</dt>
                  <dd>{formData.phone}</dd>
                </div>
                {formData.note && (
                  <div className="flex">
                    <dt className="w-32 text-accent-600">備考</dt>
                    <dd className="whitespace-pre-wrap">{formData.note}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {/* 支払い方法確認チェック */}
          {paymentType && (
            <div className="card mb-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={paymentConfirmed}
                  onChange={(e) => setPaymentConfirmed(e.target.checked)}
                  className="w-5 h-5 mt-0.5 text-primary-500 border-accent-300 rounded focus:ring-primary-500 focus:ring-2"
                />
                <span className="text-accent-800">
                  {paymentType === 'credit_card' 
                    ? '支払い方法は「クレジットカード決済」となります。'
                    : '支払い方法は「現金もしくはクレジットカード決済」となります。'
                  }
                  <span className="text-red-500 ml-1">*</span>
                </span>
              </label>
              {!paymentConfirmed && (
                <p className="text-sm text-red-500 mt-2 ml-8">
                  予約を確定するには上記をご確認ください
                </p>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="text-2xl">⚠️</div>
                <div>
                  <p className="font-bold text-red-800 mb-1">エラーが発生しました</p>
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleEdit}
              disabled={submitting}
              className="btn-secondary w-full sm:w-1/2 order-2 sm:order-1"
            >
              修正する
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !!(paymentType && !paymentConfirmed)}
              className="btn-primary w-full sm:w-1/2 order-1 sm:order-2 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
          </div>
        </div>
      ) : (
        // Input Form View
        <div className="animate-fade-in">
          {/* 予約サマリー */}
          <div className="card mb-6">
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex-1 min-w-[140px]">
                <span className="text-accent-500">日時</span>
                <div className="font-bold text-accent-800">{formattedDate} {displayTimeStr}</div>
              </div>
              <div className="flex-1 min-w-[140px]">
                <span className="text-accent-500">メニュー</span>
                <div className="font-bold text-accent-800">{selectedProgram?.name}</div>
                <div className="text-accent-600 text-xs">{selectedProgram?.service_minutes || selectedProgram?.duration || '?'}分</div>
              </div>
            </div>
          </div>

          <form onSubmit={handleConfirm} className="card">
            <h2 className="font-display font-bold text-lg text-accent-800 mb-6">
              お客様情報を入力してください
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
                お名前（フリガナ） <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="nameKana"
                name="nameKana"
                value={formData.nameKana}
                onChange={handleInputChange}
                className={`input-field ${formErrors.nameKana ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
                placeholder="ヤマダ タロウ"
              />
              {formErrors.nameKana && (
                <p className="text-sm text-red-500 mt-1">{formErrors.nameKana}</p>
              )}
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

            {/* Submit Button */}
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="w-full sm:w-1/3 btn-secondary order-2 sm:order-1"
              >
                戻る
              </button>
              <button
                type="submit"
                className="w-full sm:w-2/3 btn-primary flex items-center justify-center gap-2 order-1 sm:order-2"
              >
                確認画面へ進む
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export default function FreeBookingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">読み込み中...</p>
        </div>
      </div>
    }>
      <FreeBookingContent />
    </Suspense>
  )
}
