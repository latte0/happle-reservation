'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { sendGTMEvent } from '@next/third-parties/google'
import { getPrograms, getStudios, Program, Studio } from '@/lib/api'

type ReservationType = 'fixed' | 'free' | null

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  // URLパラメータから固定値を取得
  const fixedStudioId = searchParams.get('studio_id') ? parseInt(searchParams.get('studio_id')!) : null
  const fixedStudioCode = searchParams.get('studio_code')
  const fixedProgramId = searchParams.get('program_id') ? parseInt(searchParams.get('program_id')!) : null
  
  // UTMパラメータを保持
  const utmSource = searchParams.get('utm_source')
  const utmMedium = searchParams.get('utm_medium')
  const utmCampaign = searchParams.get('utm_campaign')
  
  const [studios, setStudios] = useState<Studio[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [selectedStudio, setSelectedStudio] = useState<number | null>(fixedStudioId)
  const [reservationType, setReservationType] = useState<ReservationType>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // 固定された店舗・メニュー情報
  const [fixedStudio, setFixedStudio] = useState<Studio | null>(null)
  const [fixedProgram, setFixedProgram] = useState<Program | null>(null)

  // URLパラメータがあるかどうか
  const hasFixedStudio = fixedStudioId !== null || fixedStudioCode !== null
  const hasFixedProgram = fixedProgramId !== null

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
        
        // 固定店舗を特定
        if (fixedStudioId) {
          const studio = studiosData.find(s => s.id === fixedStudioId)
          if (studio) {
            setFixedStudio(studio)
            setSelectedStudio(studio.id)
          }
        } else if (fixedStudioCode) {
          const studio = studiosData.find(s => s.code === fixedStudioCode)
          if (studio) {
            setFixedStudio(studio)
            setSelectedStudio(studio.id)
          }
        }
        
        // 固定メニューを特定
        if (fixedProgramId) {
          const program = programsData.find(p => p.id === fixedProgramId)
          if (program) {
            setFixedProgram(program)
            // メニューが固定されている場合は自動的に固定枠予約を選択
            setReservationType('fixed')
          }
        }
      } catch (err) {
        setError('データの読み込みに失敗しました')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [fixedStudioId, fixedStudioCode, fixedProgramId])

  // UTMパラメータを引き継ぐためのヘルパー関数
  const buildUrlParams = (baseParams: Record<string, string | number | null>) => {
    const params = new URLSearchParams()
    
    // 基本パラメータを追加
    Object.entries(baseParams).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        params.set(key, value.toString())
      }
    })
    
    // UTMパラメータを引き継ぎ
    if (utmSource) params.set('utm_source', utmSource)
    if (utmMedium) params.set('utm_medium', utmMedium)
    if (utmCampaign) params.set('utm_campaign', utmCampaign)
    
    // 固定値も引き継ぎ
    if (fixedStudioCode) params.set('studio_code', fixedStudioCode)
    
    return params.toString()
  }

  const handleProgramSelect = (programId: number) => {
    // GTMイベント: メニュー選択
    const selectedProgram = programs.find(p => p.id === programId)
    sendGTMEvent({
      event: 'menu_select',
      program_id: programId,
      program_name: selectedProgram?.name || '',
      studio_id: selectedStudio,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    })
    
    const params = buildUrlParams({
      program_id: programId,
      studio_id: selectedStudio
    })
    router.push(`/schedule?${params}`)
  }

  const handleFreeReservation = () => {
    // GTMイベント: 自由枠予約開始
    sendGTMEvent({
      event: 'free_reservation_start',
      studio_id: selectedStudio,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    })
    
    const params = buildUrlParams({
      studio_id: selectedStudio
    })
    const queryString = params ? `?${params}` : ''
    router.push(`/${queryString}`)
  }

  // 固定メニューがある場合は直接スケジュールページへ遷移するボタン
  const handleFixedProgramContinue = () => {
    if (fixedProgram) {
      // GTMイベント: 固定メニュー選択
      sendGTMEvent({
        event: 'menu_select',
        program_id: fixedProgram.id,
        program_name: fixedProgram.name,
        studio_id: fixedStudio?.id,
        is_fixed: true,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      })
      handleProgramSelect(fixedProgram.id)
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

      {/* 固定店舗の表示 */}
      {hasFixedStudio && fixedStudio && (
        <section className="mb-8 animate-fade-in">
          <div className="card bg-gradient-to-br from-blue-50 to-white border border-blue-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-blue-600 font-medium">ご予約店舗</p>
                <h3 className="font-display font-bold text-lg text-accent-900">{fixedStudio.name}</h3>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 固定メニューの表示 */}
      {hasFixedProgram && fixedProgram && (
        <section className="mb-8 animate-fade-in">
          <div className="card bg-gradient-to-br from-primary-50 to-white border border-primary-100">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-primary-200 rounded-xl flex items-center justify-center flex-shrink-0">
                <span className="text-3xl">🌿</span>
              </div>
              <div className="flex-1">
                <p className="text-sm text-primary-600 font-medium mb-1">ご予約メニュー</p>
                <h3 className="font-display font-bold text-lg text-accent-900 mb-2">{fixedProgram.name}</h3>
                {fixedProgram.description && (
                  <p className="text-sm text-accent-600 mb-3">{fixedProgram.description}</p>
                )}
                <div className="flex items-center gap-4 text-sm text-accent-500">
                  {fixedProgram.duration && (
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {fixedProgram.duration}分
                    </span>
                  )}
                  {fixedProgram.price && (
                    <span className="flex items-center gap-1 font-medium text-primary-600">
                      ¥{fixedProgram.price.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleFixedProgramContinue}
              className="btn-primary w-full mt-6 flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              日時を選択する
            </button>
          </div>
        </section>
      )}

      {/* メニューが固定されていない場合のみ予約タイプ選択を表示 */}
      {!hasFixedProgram && (
        <>
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

          {/* Studio Selection - 店舗が固定されていない場合のみ表示 */}
          {studios.length > 1 && reservationType === 'fixed' && !hasFixedStudio && (
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
        </>
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

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">読み込み中...</p>
        </div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  )
}
