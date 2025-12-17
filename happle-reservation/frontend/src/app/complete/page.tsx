'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { sendGTMEvent } from '@next/third-parties/google'

// DataLayer用の型定義
declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
  }
}

function CompleteContent() {
  const searchParams = useSearchParams()
  
  // 予約情報
  const reservationId = searchParams.get('reservation_id')
  const name = searchParams.get('name')
  const email = searchParams.get('email')
  
  // 追加の計測情報
  const studioId = searchParams.get('studio_id')
  const studioCode = searchParams.get('studio_code')
  const studioName = searchParams.get('studio_name')
  const programId = searchParams.get('program_id')
  const programName = searchParams.get('program_name')
  const reservationDate = searchParams.get('reservation_date')
  const reservationTime = searchParams.get('reservation_time')
  const duration = searchParams.get('duration')
  const price = searchParams.get('price')
  
  // UTMパラメータ
  const utmSource = searchParams.get('utm_source')
  const utmMedium = searchParams.get('utm_medium')
  const utmCampaign = searchParams.get('utm_campaign')

  // GTM DataLayer push - 予約完了イベント
  useEffect(() => {
    // @next/third-partiesのsendGTMEventを使用
    sendGTMEvent({
      event: 'reservation_complete',
      reservation_id: reservationId,
      studio_id: studioId,
      studio_code: studioCode,
      studio_name: studioName,
      program_id: programId,
      program_name: programName,
      reservation_date: reservationDate,
      reservation_time: reservationTime,
      duration: duration,
      price: price,
      customer_name: name,
      customer_email: email,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    })
    
    // フォールバック: window.dataLayerに直接push（GTM IDが未設定の場合も動作確認可能）
    if (typeof window !== 'undefined') {
      window.dataLayer = window.dataLayer || []
      window.dataLayer.push({
        event: 'reservation_complete',
        reservation_id: reservationId,
        studio_id: studioId,
        studio_code: studioCode,
        studio_name: studioName,
        program_id: programId,
        program_name: programName,
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        duration: duration,
        price: price,
        customer_name: name,
        customer_email: email,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      })
      
      // デバッグ用ログ
      console.log('[GTM] reservation_complete event pushed:', {
        reservation_id: reservationId,
        studio_id: studioId,
        studio_code: studioCode,
        program_id: programId,
      })
    }
  }, [reservationId, studioId, studioCode, studioName, programId, programName, 
      reservationDate, reservationTime, duration, price, name, email,
      utmSource, utmMedium, utmCampaign])

  // 予約確認ページのURL
  const reservationDetailUrl = reservationId 
    ? `/reservation-detail?reservation_id=${reservationId}` 
    : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Success Animation */}
      <div className="text-center mb-8 animate-fade-in">
        <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-500 rounded-full mx-auto mb-6 flex items-center justify-center shadow-lg shadow-green-500/30">
          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-display text-3xl font-bold text-accent-900 mb-3">
          ご予約ありがとうございます
        </h1>
        <p className="text-accent-600">
          ご予約が完了しました
        </p>
      </div>

      {/* Reservation Details */}
      <div className="card mb-8 animate-fade-in-delay-1">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-lg text-accent-800">
            予約情報
          </h2>
        </div>
        
        <div className="space-y-3 text-sm">
          {reservationId && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">予約番号</span>
              <span className="font-mono font-medium text-accent-900">#{reservationId}</span>
            </div>
          )}
          {name && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">お名前</span>
              <span className="font-medium text-accent-900">{name} 様</span>
            </div>
          )}
          {studioName && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">店舗</span>
              <span className="font-medium text-accent-900">{studioName}</span>
            </div>
          )}
          {programName && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">メニュー</span>
              <span className="font-medium text-accent-900">{programName}</span>
            </div>
          )}
          {reservationDate && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">予約日時</span>
              <span className="font-medium text-accent-900">
                {reservationDate} {reservationTime && `${reservationTime}`}
              </span>
            </div>
          )}
          {duration && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">所要時間</span>
              <span className="font-medium text-accent-900">{duration}分</span>
            </div>
          )}
          {email && (
            <div className="flex justify-between py-2">
              <span className="text-accent-500">メールアドレス</span>
              <span className="font-medium text-accent-900">{email}</span>
            </div>
          )}
        </div>
      </div>

      {/* Reservation Detail Link */}
      {reservationDetailUrl && (
        <div className="card bg-gradient-to-br from-green-50 to-white border border-green-100 mb-8 animate-fade-in-delay-1">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-accent-800 mb-1">予約確認・キャンセル</h3>
              <p className="text-sm text-accent-600 mb-3">
                下記リンクから予約の確認・キャンセルができます。このページをブックマークしておくことをおすすめします。
              </p>
              <Link 
                href={reservationDetailUrl}
                className="inline-flex items-center gap-2 text-sm text-green-600 hover:text-green-700 font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                予約確認ページを開く
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Email Notice */}
      <div className="card bg-gradient-to-br from-blue-50 to-white border border-blue-100 mb-8 animate-fade-in-delay-2">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-accent-800 mb-1">確認メールをお送りしました</h3>
            <p className="text-sm text-accent-600">
              ご登録いただいたメールアドレスに予約確認メールをお送りしました。
              メールが届かない場合は、迷惑メールフォルダをご確認ください。
            </p>
          </div>
        </div>
      </div>

      {/* Important Notes */}
      <div className="card bg-gradient-to-br from-primary-50 to-white border border-primary-100 mb-8 animate-fade-in-delay-3">
        <h3 className="font-display font-bold text-accent-800 mb-4">
          ご来店時のお願い
        </h3>
        <ul className="space-y-3 text-sm text-accent-600">
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span>ご予約時間の5分前までにお越しください</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span>予約確認メールまたはこの画面を受付でご提示ください</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span>キャンセル・変更は前日までにご連絡ください</span>
          </li>
        </ul>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 animate-fade-in-delay-3">
        <Link href="/" className="btn-primary flex-1 text-center">
          トップページへ戻る
        </Link>
        <button 
          onClick={() => window.print()}
          className="btn-secondary flex-1 flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          印刷する
        </button>
      </div>
    </div>
  )
}

export default function CompletePage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">読み込み中...</p>
        </div>
      </div>
    }>
      <CompleteContent />
    </Suspense>
  )
}
