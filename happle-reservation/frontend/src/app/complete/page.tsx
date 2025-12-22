'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { sendGTMEvent } from '@next/third-parties/google'

function CompleteContent() {
  const searchParams = useSearchParams()
  
  // 予約情報
  const reservationId = searchParams.get('reservation_id')
  const memberId = searchParams.get('member_id')
  const verifyHash = searchParams.get('verify')
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
  
  // LINE公式アカウントURL
  const lineUrl = searchParams.get('line_url')
  
  // 店舗連絡先情報
  const studioZip = searchParams.get('studio_zip')
  const studioAddress = searchParams.get('studio_address')
  const studioTel = searchParams.get('studio_tel')
  const studioUrl = searchParams.get('studio_url')
  const studioEmail = searchParams.get('studio_email')

  // GTM DataLayer push - 予約完了イベント
  useEffect(() => {
    // @next/third-partiesのsendGTMEventを使用
    // GTMにイベントを送信
    const eventData = {
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
    }
    
    sendGTMEvent(eventData)
    
    // デバッグ用ログ
    console.log('[GTM] reservation_complete event pushed:', eventData)
  }, [reservationId, studioId, studioCode, studioName, programId, programName, 
      reservationDate, reservationTime, duration, price, name, email,
      utmSource, utmMedium, utmCampaign])

  // 予約確認ページのURL（member_id + verifyハッシュで認証）
  const buildDetailUrl = () => {
    if (!reservationId || !memberId || !verifyHash) return null
    const params = new URLSearchParams()
    params.set('reservation_id', reservationId)
    params.set('member_id', memberId)
    params.set('verify', verifyHash)
    if (lineUrl) params.set('line_url', lineUrl)
    if (studioZip) params.set('studio_zip', studioZip)
    if (studioAddress) params.set('studio_address', studioAddress)
    if (studioTel) params.set('studio_tel', studioTel)
    if (studioUrl) params.set('studio_url', studioUrl)
    if (studioEmail) params.set('studio_email', studioEmail)
    return `/reservation-detail?${params.toString()}`
  }
  const reservationDetailUrl = buildDetailUrl()

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

      {/* LINE Registration - LINE URLがある場合のみ表示 */}
      {lineUrl && (
        <div className="card bg-gradient-to-br from-[#06C755]/10 to-white border border-[#06C755]/30 mb-8 animate-fade-in-delay-1">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-[#06C755] rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.349 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
              </svg>
            </div>
            <h3 className="font-display font-bold text-lg text-accent-800">
              【重要】公式LINEの登録
            </h3>
          </div>
          
          <p className="text-sm text-accent-700 mb-4">
            公式LINEにフルネームをお送りいただきますと、ご予約完了となります。
          </p>
          
          <a
            href={lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium bg-[#06C755] text-white hover:bg-[#05a847] transition-all mb-4"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.349 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
            </svg>
            公式LINEを登録
          </a>
          
          <ul className="space-y-2 text-sm text-accent-600">
            <li className="flex items-start gap-2">
              <span className="text-[#06C755] mt-0.5">※</span>
              <span>下記内容をご確認の上、友だち追加をお願いします</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#06C755] mt-0.5">※</span>
              <span>LINEをお持ちでない方は空メールをお送りくださいませ</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#06C755] mt-0.5">※</span>
              <span>2日以内にご返信がない場合は自動キャンセルさせていただきますのでご了承ください</span>
            </li>
          </ul>
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

      {/* 当日の注意事項 */}
      <div className="card bg-gradient-to-br from-amber-50 to-white border border-amber-100 mb-8 animate-fade-in-delay-3">
        <h3 className="font-display font-bold text-accent-800 mb-4">
          【当日の注意事項について】
        </h3>
        <ul className="space-y-3 text-sm text-accent-600">
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-amber-600 text-xs font-bold">!</span>
            </span>
            <span>持病がある方に関しては施術によっては医師の同意書が必要になります</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-amber-600 text-xs font-bold">!</span>
            </span>
            <span>妊娠中の方の施術はお断りさせていただいております</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-amber-600 text-xs font-bold">!</span>
            </span>
            <span>未成年の方は親権者同伴以外の場合、施術不可となります</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span>生理中でも施術は可能です</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-amber-600 text-xs font-bold">!</span>
            </span>
            <span>お支払いはクレジットカードのみとなります（カード番号が必要になります）</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-amber-600 text-xs font-bold">!</span>
            </span>
            <span>初回お試しは全店舗を通して、お一人様一回までとなっております。2回目のご利用の方は通常料金でのご案内となります</span>
          </li>
        </ul>
      </div>

      {/* キャンセルについて */}
      <div className="card bg-gradient-to-br from-red-50 to-white border border-red-100 mb-8 animate-fade-in-delay-3">
        <h3 className="font-display font-bold text-accent-800 mb-4">
          【キャンセルについて】
        </h3>
        <ul className="space-y-3 text-sm text-accent-600">
          <li className="flex items-start gap-3">
            <span className="text-red-500 mt-0.5">◆</span>
            <span>
              {lineUrl 
                ? 'キャンセルはご予約日の前日18時までにLINEにてご連絡くださいませ' 
                : 'キャンセルはご予約日の前日18時までにご連絡くださいませ'}
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-red-500 mt-0.5">◆</span>
            <span>無断キャンセルの場合は正規の施術代をご負担いただきます。また、次回よりご予約がお取りいただけなくなる場合がございます</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-red-500 mt-0.5">◆</span>
            <span>前日18時以降のキャンセルやご変更は直前キャンセル料2200円を銀行振り込みにてご請求させていただきます</span>
          </li>
        </ul>
        <p className="text-xs text-accent-500 mt-4">
          お願いばかりで申し訳ございませんが、一部ルールをお守りいただけない方がいらっしゃいますので予めご了承くださいませ。
        </p>
      </div>

      {/* 店舗情報 */}
      {(studioName || studioZip || studioAddress || studioTel || studioUrl || studioEmail) && (
        <div className="card bg-gradient-to-br from-gray-50 to-white border border-gray-100 mb-8 animate-fade-in-delay-3">
          <h3 className="font-display font-bold text-accent-800 mb-4">
            店舗情報
          </h3>
          <div className="space-y-2 text-sm text-accent-600">
            {studioName && (
              <div className="font-medium text-accent-800">{studioName}</div>
            )}
            {(studioZip || studioAddress) && (
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 text-accent-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>{studioZip && `〒${studioZip} `}{studioAddress}</span>
              </div>
            )}
            {studioTel && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-accent-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <a href={`tel:${studioTel}`} className="text-primary-600 hover:text-primary-700">{studioTel}</a>
              </div>
            )}
            {studioEmail && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-accent-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <a href={`mailto:${studioEmail}`} className="text-primary-600 hover:text-primary-700">{studioEmail}</a>
              </div>
            )}
            {studioUrl && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-accent-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <a href={studioUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700">{studioUrl}</a>
              </div>
            )}
          </div>
        </div>
      )}

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
