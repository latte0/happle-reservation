'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getReservationDetail, cancelReservation, ReservationDetail } from '@/lib/api'

function ReservationDetailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const reservationId = searchParams.get('reservation_id')
  const memberId = searchParams.get('member_id')
  const verifyHash = searchParams.get('verify')
  
  const [detail, setDetail] = useState<ReservationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelSuccess, setCancelSuccess] = useState(false)

  useEffect(() => {
    async function loadReservation() {
      // 認証パラメータのチェック
      if (!reservationId || !memberId || !verifyHash) {
        setError('認証情報が不足しています。正しいリンクからアクセスしてください。')
        setLoading(false)
        return
      }
      
      try {
        setLoading(true)
        const data = await getReservationDetail(
          parseInt(reservationId),
          parseInt(memberId),
          verifyHash
        )
        if (data) {
          setDetail(data)
        } else {
          setError('予約が見つからないか、認証に失敗しました')
        }
      } catch (err) {
        setError('予約情報の取得に失敗しました')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    
    loadReservation()
  }, [reservationId, memberId, verifyHash])

  const handleCancel = async () => {
    if (!reservationId || !memberId || !verifyHash) return
    
    setCanceling(true)
    try {
      const result = await cancelReservation(
        parseInt(reservationId),
        parseInt(memberId),
        verifyHash
      )
      if (result.success) {
        setCancelSuccess(true)
        setShowCancelConfirm(false)
        // 予約情報を再取得
        const data = await getReservationDetail(
          parseInt(reservationId),
          parseInt(memberId),
          verifyHash
        )
        if (data) {
          setDetail(data)
        }
      } else {
        alert(result.error || 'キャンセルに失敗しました')
      }
    } catch (err) {
      alert('キャンセル処理中にエラーが発生しました')
      console.error(err)
    } finally {
      setCanceling(false)
    }
  }

  // 日時のフォーマット
  const formatDateTime = (isoString: string) => {
    if (!isoString) return ''
    try {
      const date = new Date(isoString)
      const weekdays = ['日', '月', '火', '水', '木', '金', '土']
      const year = date.getFullYear()
      const month = date.getMonth() + 1
      const day = date.getDate()
      const weekday = weekdays[date.getDay()]
      const hours = date.getHours().toString().padStart(2, '0')
      const minutes = date.getMinutes().toString().padStart(2, '0')
      return `${year}年${month}月${day}日(${weekday}) ${hours}:${minutes}`
    } catch {
      return isoString
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">予約情報を読み込んでいます...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="card text-center">
          <div className="text-5xl mb-4">😢</div>
          <h2 className="font-display text-xl font-bold text-accent-900 mb-2">
            エラーが発生しました
          </h2>
          <p className="text-accent-600 mb-6">{error}</p>
          <Link href="/" className="btn-primary inline-block">
            トップページへ戻る
          </Link>
        </div>
      </div>
    )
  }

  if (!detail) {
    return null
  }

  const { reservation, member, studio, program } = detail
  const isConfirmed = reservation.status === 2
  const isCanceled = reservation.status === 4 || reservation.status === 5

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="text-center mb-8 animate-fade-in">
        <div className={`w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center ${
          isCanceled 
            ? 'bg-gradient-to-br from-gray-400 to-gray-500' 
            : cancelSuccess
              ? 'bg-gradient-to-br from-orange-400 to-orange-500'
              : 'bg-gradient-to-br from-primary-400 to-primary-500'
        } shadow-lg`}>
          {isCanceled ? (
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : cancelSuccess ? (
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          )}
        </div>
        <h1 className="font-display text-2xl font-bold text-accent-900 mb-2">
          {cancelSuccess ? 'キャンセルが完了しました' : '予約確認'}
        </h1>
        <div className={`inline-block px-4 py-1 rounded-full text-sm font-medium ${
          isCanceled
            ? 'bg-gray-100 text-gray-600'
            : isConfirmed
              ? 'bg-green-100 text-green-700'
              : 'bg-yellow-100 text-yellow-700'
        }`}>
          {reservation.status_label}
        </div>
      </div>

      {/* キャンセル成功メッセージ */}
      {cancelSuccess && (
        <div className="card bg-gradient-to-br from-orange-50 to-white border border-orange-100 mb-8 animate-fade-in">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-accent-800 mb-1">予約がキャンセルされました</h3>
              <p className="text-sm text-accent-600">
                キャンセル処理が完了しました。またのご予約をお待ちしております。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Reservation Details */}
      <div className="card mb-8 animate-fade-in-delay-1">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-lg text-accent-800">
            予約情報
          </h2>
        </div>
        
        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-accent-100">
            <span className="text-accent-500">予約番号</span>
            <span className="font-mono font-medium text-accent-900">#{reservation.id}</span>
          </div>
          
          {reservation.start_at && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">予約日時</span>
              <span className="font-medium text-accent-900">
                {formatDateTime(reservation.start_at)}
                {reservation.end_at && (
                  <> - {new Date(reservation.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </span>
            </div>
          )}
          
          {studio?.name && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">店舗</span>
              <span className="font-medium text-accent-900">{studio.name}</span>
            </div>
          )}
          
          {program?.name && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">メニュー</span>
              <span className="font-medium text-accent-900">{program.name}</span>
            </div>
          )}
          
          {program?.duration > 0 && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">所要時間</span>
              <span className="font-medium text-accent-900">{program.duration}分</span>
            </div>
          )}
          
          {program?.price > 0 && (
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">料金</span>
              <span className="font-medium text-accent-900">¥{program.price.toLocaleString()}</span>
            </div>
          )}
          
          <div className="flex justify-between py-2">
            <span className="text-accent-500">予約日</span>
            <span className="font-medium text-accent-900">
              {new Date(reservation.created_at).toLocaleString('ja-JP')}
            </span>
          </div>
        </div>
      </div>

      {/* Customer Info */}
      {member?.name && (
        <div className="card mb-8 animate-fade-in-delay-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="font-display font-bold text-lg text-accent-800">
              お客様情報
            </h2>
          </div>
          
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">お名前</span>
              <span className="font-medium text-accent-900">{member.name}</span>
            </div>
            {member.name_kana && (
              <div className="flex justify-between py-2 border-b border-accent-100">
                <span className="text-accent-500">フリガナ</span>
                <span className="font-medium text-accent-900">{member.name_kana}</span>
              </div>
            )}
            {member.email && (
              <div className="flex justify-between py-2 border-b border-accent-100">
                <span className="text-accent-500">メールアドレス</span>
                <span className="font-medium text-accent-900">{member.email}</span>
              </div>
            )}
            {member.phone && (
              <div className="flex justify-between py-2">
                <span className="text-accent-500">電話番号</span>
                <span className="font-medium text-accent-900">{member.phone}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Store Info */}
      {studio?.address && (
        <div className="card mb-8 animate-fade-in-delay-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h2 className="font-display font-bold text-lg text-accent-800">
              店舗情報
            </h2>
          </div>
          
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">店舗名</span>
              <span className="font-medium text-accent-900">{studio.name}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-accent-100">
              <span className="text-accent-500">住所</span>
              <span className="font-medium text-accent-900">{studio.address}</span>
            </div>
            {studio.tel && (
              <div className="flex justify-between py-2">
                <span className="text-accent-500">電話番号</span>
                <a href={`tel:${studio.tel}`} className="font-medium text-primary-600 hover:text-primary-700">
                  {studio.tel}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel Button */}
      {reservation.is_cancelable && !cancelSuccess && (
        <div className="card bg-gradient-to-br from-red-50 to-white border border-red-100 mb-8 animate-fade-in-delay-3">
          <h3 className="font-display font-bold text-accent-800 mb-3">
            予約のキャンセル
          </h3>
          <p className="text-sm text-accent-600 mb-4">
            キャンセルをご希望の場合は、下記ボタンからお手続きください。
            なお、キャンセル後の予約復活はできませんのでご注意ください。
          </p>
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="w-full py-3 px-4 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            この予約をキャンセルする
          </button>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full animate-fade-in">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="font-display font-bold text-xl text-accent-900 mb-2">
                予約をキャンセルしますか？
              </h3>
              <p className="text-sm text-accent-600">
                この操作は取り消せません。本当にキャンセルしてもよろしいですか？
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                disabled={canceling}
                className="flex-1 py-3 px-4 bg-accent-100 text-accent-700 rounded-xl font-medium hover:bg-accent-200 transition-colors disabled:opacity-50"
              >
                戻る
              </button>
              <button
                onClick={handleCancel}
                disabled={canceling}
                className="flex-1 py-3 px-4 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center"
              >
                {canceling ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    処理中...
                  </>
                ) : (
                  'キャンセルする'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 animate-fade-in-delay-3">
        <Link href="/" className="btn-primary flex-1 text-center">
          新規予約をする
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

export default function ReservationDetailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">読み込み中...</p>
        </div>
      </div>
    }>
      <ReservationDetailContent />
    </Suspense>
  )
}

