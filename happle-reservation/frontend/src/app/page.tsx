'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getPrograms, getStudios, Program, Studio } from '@/lib/api'

type ReservationType = 'fixed' | 'free' | null

export default function HomePage() {
  const router = useRouter()
  const [studios, setStudios] = useState<Studio[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [selectedStudio, setSelectedStudio] = useState<number | null>(null)
  const [reservationType, setReservationType] = useState<ReservationType>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const [studiosData, programsData] = await Promise.all([
          getStudios(),
          getPrograms()
        ])
        setStudios(studiosData)
        setPrograms(programsData)
      } catch (err) {
        setError('データの読み込みに失敗しました')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const handleProgramSelect = (programId: number) => {
    const params = new URLSearchParams()
    params.set('program_id', programId.toString())
    if (selectedStudio) {
      params.set('studio_id', selectedStudio.toString())
    }
    router.push(`/schedule?${params.toString()}`)
  }

  const handleFreeReservation = () => {
    // 自由枠予約ページへ直接遷移（店舗・メニューは遷移先で選択）
    router.push(`/free-schedule`)
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

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">😢</div>
          <p className="text-accent-600">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="btn-primary mt-4"
          >
            再読み込み
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Hero Section */}
      <section className="text-center mb-12 animate-fade-in">
        <div className="inline-block mb-6">
          <span className="bg-primary-100 text-primary-700 text-sm font-medium px-4 py-2 rounded-full">
            かんたんオンライン予約
          </span>
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-bold text-accent-900 mb-4">
          ご予約はこちらから
        </h2>
        <p className="text-accent-600 max-w-xl mx-auto">
          お好きなメニューと日時を選んで、簡単にご予約いただけます。
          心と体のリラックスタイムをお過ごしください。
        </p>
      </section>

      {/* Reservation Type Selection */}
      <section className="mb-10 animate-fade-in-delay-1">
        <h3 className="font-display text-xl font-bold text-accent-800 mb-4">
          予約タイプを選択
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <button
            onClick={() => setReservationType('fixed')}
            className={`p-6 rounded-2xl border-2 transition-all text-left ${
              reservationType === 'fixed'
                ? 'border-primary-500 bg-primary-50 shadow-lg shadow-primary-500/10'
                : 'border-accent-200 bg-white hover:border-primary-300 hover:bg-primary-50/50'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                reservationType === 'fixed' ? 'bg-primary-500 text-white' : 'bg-accent-100 text-accent-600'
              }`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h4 className="font-bold text-accent-900">固定枠予約（レッスン）</h4>
                <p className="text-sm text-accent-500">決まったスケジュールから予約</p>
              </div>
            </div>
            <p className="text-sm text-accent-600">
              インストラクターが設定したレッスン枠から、ご希望の日時をお選びください。
            </p>
          </button>

          <button
            onClick={() => setReservationType('free')}
            className={`p-6 rounded-2xl border-2 transition-all text-left ${
              reservationType === 'free'
                ? 'border-primary-500 bg-primary-50 shadow-lg shadow-primary-500/10'
                : 'border-accent-200 bg-white hover:border-primary-300 hover:bg-primary-50/50'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                reservationType === 'free' ? 'bg-primary-500 text-white' : 'bg-accent-100 text-accent-600'
              }`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h4 className="font-bold text-accent-900">自由枠予約</h4>
                <p className="text-sm text-accent-500">お好きな時間で予約</p>
              </div>
            </div>
            <p className="text-sm text-accent-600">
              営業時間内でご希望の開始時間をお選びいただけます。空いているスタッフを自動で割り当てます。
            </p>
          </button>
        </div>
      </section>

      {/* Studio Selection */}
      {studios.length > 1 && reservationType === 'fixed' && (
        <section className="mb-10 animate-fade-in">
          <h3 className="font-display text-xl font-bold text-accent-800 mb-4">
            店舗を選択
          </h3>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setSelectedStudio(null)}
              className={`px-5 py-2.5 rounded-xl font-medium transition-all ${
                selectedStudio === null
                  ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25'
                  : 'bg-accent-100 text-accent-700 hover:bg-accent-200'
              }`}
            >
              すべての店舗
            </button>
            {studios.map((studio) => (
              <button
                key={studio.id}
                onClick={() => setSelectedStudio(studio.id)}
                className={`px-5 py-2.5 rounded-xl font-medium transition-all ${
                  selectedStudio === studio.id
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25'
                    : 'bg-accent-100 text-accent-700 hover:bg-accent-200'
                }`}
              >
                {studio.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Fixed Reservation - Programs Grid */}
      {reservationType === 'fixed' && (
        <section className="animate-fade-in">
          <h3 className="font-display text-xl font-bold text-accent-800 mb-6">
            メニューを選択
          </h3>
        
          {programs.length === 0 ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-4">🍃</div>
              <p className="text-accent-600">現在予約可能なメニューはありません</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {programs.map((program, index) => (
                <div
                  key={program.id}
                  className="card card-hover group"
                  onClick={() => handleProgramSelect(program.id)}
                  style={{ animationDelay: `${0.1 * index}s` }}
                >
                  {/* Program Image Placeholder */}
                  <div className="aspect-video bg-gradient-to-br from-primary-100 to-primary-200 rounded-xl mb-4 flex items-center justify-center overflow-hidden">
                    <span className="text-5xl group-hover:scale-110 transition-transform duration-300">
                      🌿
                    </span>
                  </div>
                
                  {/* Program Info */}
                <div>
                  <h4 className="font-display font-bold text-lg text-accent-900 mb-2 group-hover:text-primary-600 transition-colors">
                    {program.name}
                  </h4>
                  
                  {program.description && (
                    <p className="text-sm text-accent-600 mb-3 line-clamp-2">
                      {program.description}
                    </p>
                  )}
                  
                  <div className="flex items-center gap-4 text-sm text-accent-500">
                    {program.duration && (
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {program.duration}分
                      </span>
                    )}
                    {program.price && (
                      <span className="flex items-center gap-1 font-medium text-primary-600">
                        ¥{program.price.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Arrow */}
                <div className="absolute top-4 right-4 w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Free Reservation - Direct to Schedule */}
      {reservationType === 'free' && (
        <section className="animate-fade-in">
          <div className="card bg-gradient-to-br from-primary-50 to-white border border-primary-100">
            <h3 className="font-display font-bold text-xl text-accent-800 mb-4">
              自由枠予約
            </h3>
            <p className="text-accent-600 mb-6">
              お好きな時間で予約できます。営業時間内で空いている時間帯をお選びください。
            </p>
            <button
              onClick={handleFreeReservation}
              className="btn-primary w-full md:w-auto flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              日時を選択する
            </button>
          </div>
        </section>
      )}

      {/* Info Section */}
      <section className="mt-16 animate-fade-in-delay-3">
        <div className="card bg-gradient-to-br from-primary-50 to-white border border-primary-100">
          <h3 className="font-display font-bold text-lg text-accent-800 mb-4">
            ご予約について
          </h3>
          <ul className="space-y-3 text-sm text-accent-600">
            <li className="flex items-start gap-3">
              <span className="w-5 h-5 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-primary-600 text-xs">1</span>
              </span>
              <span>メニューを選択後、ご希望の日時をお選びください</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-5 h-5 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-primary-600 text-xs">2</span>
              </span>
              <span>お客様情報をご入力いただき、予約を確定してください</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-5 h-5 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-primary-600 text-xs">3</span>
              </span>
              <span>確認メールが届きますので、当日はメールをご提示ください</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  )
}

