'use client'

import { useEffect, useState, Suspense } from 'react'
import { getPrograms, getStudios, getStudioRooms, getChoiceScheduleRange, Program, Studio, StudioRoom, ChoiceSchedule } from '@/lib/api'
import { addDays } from 'date-fns'
import { format } from 'date-fns'

function LinkGeneratorContent() {
  const [studios, setStudios] = useState<Studio[]>([])
  const [allPrograms, setAllPrograms] = useState<Program[]>([])  // 全プログラム
  const [filteredPrograms, setFilteredPrograms] = useState<Program[]>([])  // フィルタリング済みプログラム
  const [loading, setLoading] = useState(true)
  const [programsLoading, setProgramsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [studioError, setStudioError] = useState<string | null>(null)
  
  // フォーム入力値
  const [selectedStudioId, setSelectedStudioId] = useState<string>('')
  const [selectedProgramId, setSelectedProgramId] = useState<string>('')
  const [utmSource, setUtmSource] = useState('')
  const [utmMedium, setUtmMedium] = useState('')
  const [utmCampaign, setUtmCampaign] = useState('')
  const [lineUrl, setLineUrl] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  
  // 店舗連絡先情報
  const [studioZip, setStudioZip] = useState('')
  const [studioAddress, setStudioAddress] = useState('')
  const [studioTel, setStudioTel] = useState('')
  const [studioUrl, setStudioUrl] = useState('')
  const [studioEmail, setStudioEmail] = useState('')
  
  // 支払い方法
  const [paymentType, setPaymentType] = useState<'credit_card' | 'credit_card_cash' | ''>('')
  
  // 生成されたURL
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // ベースURLを初期設定
    if (typeof window !== 'undefined') {
      const envBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
      if (envBaseUrl) {
        setBaseUrl(envBaseUrl)
      } else {
        setBaseUrl(window.location.origin)
      }
    }
    
    async function loadData() {
      try {
        setLoading(true)
        const [studiosData, programsData] = await Promise.all([
          getStudios(),
          getPrograms({ filterFullyConfigured: true })
        ])
        setStudios(studiosData)
        setAllPrograms(programsData)
        setFilteredPrograms(programsData)  // 初期状態では全プログラムを表示
      } catch (err) {
        setError('データの読み込みに失敗しました')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])
  
  // 店舗選択時に予約カテゴリ設定を取得してプログラムをフィルタリング
  const handleStudioSelect = async (studioId: string) => {
    setSelectedStudioId(studioId)
    setSelectedProgramId('')  // プログラム選択をリセット
    setStudioError(null)
    
    if (!studioId) {
      // 店舗未選択時は全プログラムを表示
      setFilteredPrograms(allPrograms)
      return
    }
    
    setProgramsLoading(true)
    
    try {
      const studio = studios.find(s => s.id.toString() === studioId)
      if (!studio) {
        setFilteredPrograms(allPrograms)
        return
      }
      
      // 予約カテゴリを取得
      const roomsData = await getStudioRooms(studio.id)
      const choiceRooms = roomsData.filter(r => r.reservation_type === 'CHOICE')
      const candidateRooms = choiceRooms.length > 0 
        ? choiceRooms 
        : roomsData.filter(r => r.name.includes('Test') || r.id !== 5)
      
      if (candidateRooms.length === 0) {
        setStudioError('この店舗には予約可能なカテゴリがありません')
        setFilteredPrograms([])
        return
      }
      
      // 現在日付
      const now = new Date()
      const todayStr = format(now, 'yyyy-MM-dd')
      const weekEndStr = format(addDays(now, 6), 'yyyy-MM-dd')
      
      // 適用期間内の予約カテゴリを探す（getChoiceScheduleRangeを使用して最適化）
      let validRoomService: ChoiceSchedule['studio_room_service'] | null = null
      
      // 並列で全ての部屋のスケジュールを取得
      const roomSchedules = await Promise.all(
        candidateRooms.map(async (room) => {
        try {
            const scheduleMap = await getChoiceScheduleRange(room.id, todayStr, weekEndStr)
            const todaySchedule = scheduleMap.get(todayStr)
            return { room, scheduleData: todaySchedule }
          } catch (err) {
            console.error(`Failed to check room ${room.id}:`, err)
            return { room, scheduleData: null }
          }
        })
      )
      
      for (const { scheduleData } of roomSchedules) {
        if (!scheduleData) continue
        const roomService = scheduleData.studio_room_service
          
          if (!roomService) continue
          
          // 適用期間のチェック
          let isWithinPeriod = true
          if (roomService.start_date && roomService.end_date) {
            isWithinPeriod = todayStr >= roomService.start_date && todayStr <= roomService.end_date
          }
          
          if (isWithinPeriod) {
            validRoomService = roomService
            break
        }
      }
      
      if (!validRoomService) {
        setStudioError('この店舗は現在予約を受け付けていない期間です')
        setFilteredPrograms([])
        return
      }
      
      // 選択可能プログラムでフィルタリング
      let filtered = allPrograms.filter(p => {
        // スタジオIDでフィルタリング（プログラムにstudio_idがある場合）
        // ここでは予約カテゴリの設定に基づいてフィルタリング
        return true
      })
      
      if (validRoomService.selectable_program_type === 'SELECTED' && validRoomService.selectable_program_details) {
        const selectableProgramIds = new Set(validRoomService.selectable_program_details.map(p => p.program_id))
        filtered = allPrograms.filter(p => selectableProgramIds.has(p.id))
      }
      
      setFilteredPrograms(filtered)
      
    } catch (err) {
      console.error('Failed to load studio room service:', err)
      setStudioError('予約カテゴリ設定の読み込みに失敗しました')
      setFilteredPrograms(allPrograms)
    } finally {
      setProgramsLoading(false)
    }
  }

  const generateUrl = () => {
    const params = new URLSearchParams()
    
    // 店舗（IDとコードの両方を追加）
    if (selectedStudioId) {
      const studio = studios.find(s => s.id.toString() === selectedStudioId)
      if (studio) {
        params.set('studio_id', studio.id.toString())
        if (studio.code) {
          params.set('studio_code', studio.code)
        }
      }
    }
    
    // メニュー
    if (selectedProgramId) {
      params.set('program_id', selectedProgramId)
    }
    
    // UTMパラメータ
    if (utmSource) params.set('utm_source', utmSource)
    if (utmMedium) params.set('utm_medium', utmMedium)
    if (utmCampaign) params.set('utm_campaign', utmCampaign)
    
    // LINE公式アカウントURL
    if (lineUrl) params.set('line_url', lineUrl)
    
    // 店舗連絡先情報
    if (studioZip) params.set('studio_zip', studioZip)
    if (studioAddress) params.set('studio_address', studioAddress)
    if (studioTel) params.set('studio_tel', studioTel)
    if (studioUrl) params.set('studio_url', studioUrl)
    if (studioEmail) params.set('studio_email', studioEmail)
    
    // 支払い方法
    if (paymentType) params.set('payment_type', paymentType)
    
    const queryString = params.toString()
    // 自由枠予約画面へのリンクを生成
    const url = queryString ? `${baseUrl}/?${queryString}` : `${baseUrl}`
    
    setGeneratedUrl(url)
    setCopied(false)
  }

  const copyToClipboard = async () => {
    if (!generatedUrl) return
    
    try {
      await navigator.clipboard.writeText(generatedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const selectedStudio = studios.find(s => s.id.toString() === selectedStudioId)
  const selectedProgram = filteredPrograms.find(p => p.id.toString() === selectedProgramId)

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
      {/* Header */}
      <section className="text-center mb-12 animate-fade-in">
        <div className="inline-block mb-4">
          <span className="bg-blue-100 text-blue-700 text-sm font-medium px-4 py-2 rounded-full">
            管理画面
          </span>
        </div>
        <h2 className="font-display text-3xl font-bold text-accent-900 mb-4">
          広告リンク生成ツール
        </h2>
        <p className="text-accent-600 max-w-xl mx-auto">
          店舗・メニューを選択して、計測用のURLを生成します。<br />
          生成されたURLからアクセスすると、選択内容が固定表示されます。
        </p>
      </section>

      {/* Form */}
      <div className="card mb-8">
        <h3 className="font-display font-bold text-lg text-accent-800 mb-6">
          リンク設定
        </h3>
        
        <div className="space-y-6">
          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-accent-700 mb-2">
              ベースURL
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full px-4 py-3 border border-accent-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="https://your-domain.com"
            />
            <p className="text-xs text-accent-500 mt-1">
              本番環境では環境変数 NEXT_PUBLIC_BASE_URL を設定してください
            </p>
          </div>
          
          {/* Studio Selection */}
          <div>
            <label className="block text-sm font-medium text-accent-700 mb-2">
              店舗を選択 <span className="text-accent-400">（任意）</span>
            </label>
            <select
              value={selectedStudioId}
              onChange={(e) => handleStudioSelect(e.target.value)}
              className="w-full px-4 py-3 border border-accent-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              <option value="">店舗を指定しない</option>
              {studios.map((studio) => (
                <option key={studio.id} value={studio.id.toString()}>
                  {studio.name} {studio.code && `(${studio.code})`}
                </option>
              ))}
            </select>
            {studioError && (
              <p className="text-sm text-red-500 mt-1">{studioError}</p>
            )}
          </div>

          {/* Program Selection */}
          <div>
            <label className="block text-sm font-medium text-accent-700 mb-2">
              メニューを選択 <span className="text-accent-400">（任意）</span>
            </label>
            {programsLoading ? (
              <div className="w-full px-4 py-3 border border-accent-200 rounded-xl bg-accent-50 text-accent-500">
                読み込み中...
              </div>
            ) : (
              <select
                value={selectedProgramId}
                onChange={(e) => setSelectedProgramId(e.target.value)}
                className="w-full px-4 py-3 border border-accent-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                disabled={filteredPrograms.length === 0 && selectedStudioId !== ''}
              >
                <option value="">メニューを指定しない</option>
                {filteredPrograms.map((program) => (
                  <option key={program.id} value={program.id.toString()}>
                    {program.name} {program.price && `(¥${program.price.toLocaleString()})`}
                  </option>
                ))}
              </select>
            )}
            {selectedStudioId && filteredPrograms.length === 0 && !programsLoading && (
              <p className="text-sm text-accent-500 mt-1">この店舗で選択可能なメニューがありません</p>
            )}
          </div>

          {/* 支払い方法 */}
          <div>
            <label className="block text-sm font-medium text-accent-700 mb-2">
              支払い方法 <span className="text-accent-400">（任意）</span>
            </label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as 'credit_card' | 'credit_card_cash' | '')}
              className="w-full px-4 py-3 border border-accent-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              <option value="">支払い方法を指定しない</option>
              <option value="credit_card">クレジットカード</option>
              <option value="credit_card_cash">クレジットカード/現金</option>
            </select>
            <p className="text-xs text-accent-500 mt-1">
              選択すると予約確認画面で支払い方法の確認チェックが必須になります
            </p>
          </div>

          {/* LINE公式アカウントURL */}
          <div className="border-t border-accent-100 pt-6">
            <h4 className="text-sm font-medium text-accent-700 mb-4">
              LINE公式アカウント <span className="text-accent-400">（任意）</span>
            </h4>
            <div>
              <label className="block text-xs text-accent-500 mb-1">LINE公式アカウントURL</label>
              <input
                type="text"
                value={lineUrl}
                onChange={(e) => setLineUrl(e.target.value)}
                className="w-full px-4 py-3 border border-accent-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="https://lin.ee/xxxxxxx"
              />
              <p className="text-xs text-accent-500 mt-1">
                入力すると予約完了ページ・メールにLINE登録ボタンと注意事項が表示されます
              </p>
            </div>
          </div>

          {/* 店舗連絡先情報 */}
          <div className="border-t border-accent-100 pt-6">
            <h4 className="text-sm font-medium text-accent-700 mb-4">
              店舗連絡先情報 <span className="text-accent-400">（任意・未入力の場合はhacomonoの店舗設定から取得）</span>
            </h4>
            
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-accent-500 mb-1">郵便番号</label>
                  <input
                    type="text"
                    value={studioZip}
                    onChange={(e) => setStudioZip(e.target.value)}
                    className="w-full px-3 py-2 border border-accent-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    placeholder="860-0845"
                  />
                </div>
                <div>
                  <label className="block text-xs text-accent-500 mb-1">電話番号</label>
                  <input
                    type="text"
                    value={studioTel}
                    onChange={(e) => setStudioTel(e.target.value)}
                    className="w-full px-3 py-2 border border-accent-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    placeholder="090-3243-2739"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs text-accent-500 mb-1">住所</label>
                <input
                  type="text"
                  value={studioAddress}
                  onChange={(e) => setStudioAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-accent-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  placeholder="熊本県熊本市中央区上通町イーストンビル1階"
                />
              </div>
              
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-accent-500 mb-1">WebサイトURL</label>
                  <input
                    type="text"
                    value={studioUrl}
                    onChange={(e) => setStudioUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-accent-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    placeholder="https://example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs text-accent-500 mb-1">メールアドレス</label>
                  <input
                    type="text"
                    value={studioEmail}
                    onChange={(e) => setStudioEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-accent-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    placeholder="info@example.com"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* UTM Parameters */}
          <div className="border-t border-accent-100 pt-6">
            <h4 className="text-sm font-medium text-accent-700 mb-4">
              UTMパラメータ <span className="text-accent-400">（任意）</span>
            </h4>
            
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-accent-500 mb-1">utm_source</label>
                <input
                  type="text"
                  value={utmSource}
                  onChange={(e) => setUtmSource(e.target.value)}
                  className="w-full px-3 py-2 border border-accent-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  placeholder="google"
                />
              </div>
              <div>
                <label className="block text-xs text-accent-500 mb-1">utm_medium</label>
                <input
                  type="text"
                  value={utmMedium}
                  onChange={(e) => setUtmMedium(e.target.value)}
                  className="w-full px-3 py-2 border border-accent-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  placeholder="cpc"
                />
              </div>
              <div>
                <label className="block text-xs text-accent-500 mb-1">utm_campaign</label>
                <input
                  type="text"
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  className="w-full px-3 py-2 border border-accent-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  placeholder="summer_sale"
                />
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={generateUrl}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            リンクを生成
          </button>
        </div>
      </div>

      {/* Generated URL */}
      {generatedUrl && (
        <div className="card bg-gradient-to-br from-green-50 to-white border border-green-100 mb-8 animate-fade-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-display font-bold text-lg text-accent-800">
              生成されたURL
            </h3>
          </div>
          
          <div className="bg-white border border-accent-200 rounded-xl p-4 mb-4">
            <code className="text-sm text-accent-800 break-all">{generatedUrl}</code>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={copyToClipboard}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium transition-all ${
                copied 
                  ? 'bg-green-500 text-white' 
                  : 'bg-accent-100 text-accent-700 hover:bg-accent-200'
              }`}
            >
              {copied ? (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  コピーしました
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  URLをコピー
                </>
              )}
            </button>
            <a
              href={generatedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium bg-primary-500 text-white hover:bg-primary-600 transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              プレビュー
            </a>
          </div>

          {/* Preview Info */}
          <div className="mt-6 pt-6 border-t border-green-100">
            <h4 className="text-sm font-medium text-accent-700 mb-3">設定内容プレビュー</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-accent-500">店舗</span>
                <span className="text-accent-800">{selectedStudio ? selectedStudio.name : '指定なし'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-accent-500">メニュー</span>
                <span className="text-accent-800">{selectedProgram ? selectedProgram.name : '指定なし'}</span>
              </div>
              {utmSource && (
                <div className="flex justify-between">
                  <span className="text-accent-500">utm_source</span>
                  <span className="text-accent-800">{utmSource}</span>
                </div>
              )}
              {utmMedium && (
                <div className="flex justify-between">
                  <span className="text-accent-500">utm_medium</span>
                  <span className="text-accent-800">{utmMedium}</span>
                </div>
              )}
              {utmCampaign && (
                <div className="flex justify-between">
                  <span className="text-accent-500">utm_campaign</span>
                  <span className="text-accent-800">{utmCampaign}</span>
                </div>
              )}
              {lineUrl && (
                <div className="flex justify-between">
                  <span className="text-accent-500">LINE公式アカウント</span>
                  <span className="text-accent-800 truncate max-w-[200px]">{lineUrl}</span>
                </div>
              )}
              {(studioZip || studioAddress || studioTel || studioUrl || studioEmail) && (
                <div className="border-t border-green-100 pt-2 mt-2">
                  <span className="text-accent-500 text-xs">店舗連絡先情報</span>
                  {studioZip && (
                    <div className="flex justify-between">
                      <span className="text-accent-500">郵便番号</span>
                      <span className="text-accent-800">{studioZip}</span>
                    </div>
                  )}
                  {studioAddress && (
                    <div className="flex justify-between">
                      <span className="text-accent-500">住所</span>
                      <span className="text-accent-800 truncate max-w-[200px]">{studioAddress}</span>
                    </div>
                  )}
                  {studioTel && (
                    <div className="flex justify-between">
                      <span className="text-accent-500">電話番号</span>
                      <span className="text-accent-800">{studioTel}</span>
                    </div>
                  )}
                  {studioUrl && (
                    <div className="flex justify-between">
                      <span className="text-accent-500">WebサイトURL</span>
                      <span className="text-accent-800 truncate max-w-[200px]">{studioUrl}</span>
                    </div>
                  )}
                  {studioEmail && (
                    <div className="flex justify-between">
                      <span className="text-accent-500">メールアドレス</span>
                      <span className="text-accent-800 truncate max-w-[200px]">{studioEmail}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GTM Info */}
      <div className="card bg-gradient-to-br from-blue-50 to-white border border-blue-100">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-accent-800 mb-2">GTM計測について</h3>
            <ul className="text-sm text-accent-600 space-y-1">
              <li>• 全ページにGTMタグが設置されています</li>
              <li>• 予約完了時に <code className="bg-blue-100 px-1 rounded">reservation_complete</code> イベントが発火します</li>
              <li>• イベントには店舗ID、メニューID、UTMパラメータが含まれます</li>
              <li>• GTM管理画面でタグの出し分け設定が可能です</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LinkGeneratorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">読み込み中...</p>
        </div>
      </div>
    }>
      <LinkGeneratorContent />
    </Suspense>
  )
}

