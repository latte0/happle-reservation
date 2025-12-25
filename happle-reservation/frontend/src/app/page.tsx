'use client'

import { useEffect, useState, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { sendGTMEvent } from '@next/third-parties/google'
import { getChoiceScheduleRange, getStudios, getPrograms, getStudioRooms, checkReservability, ChoiceSchedule, Studio, Program, StudioRoom, hasSelectableInstructors, hasSelectableResources, getSelectableInstructorIds } from '@/lib/api'
import { format, addDays, startOfDay, subDays, parseISO, isSameDay } from 'date-fns'
import { ja } from 'date-fns/locale'

// タイムスロットの型定義
type UnavailableReason = 
  | 'available'           // 予約可能
  | 'holiday'             // 休業日
  | 'outside_hours'       // 営業時間外
  | 'fully_booked'        // 満席（全スタッフ予約済み）
  | 'too_soon'            // 予約開始前（30分後以降から予約可能）
  | 'too_far'             // 予約期限外（14日後まで）
  | 'deadline_passed'     // 予約締切を過ぎている
  | 'interval_blocked'    // インターバルでブロック中
  | 'no_selectable_staff' // 選択可能なスタッフがいない
  | 'no_available_resource' // 利用可能な設備がない
  | 'daily_limit_reached' // 1日の予約上限に達している

interface GridSlot {
  date: Date
  time: string
  startAt: string
  available: boolean
  isHoliday: boolean
  unavailableReason: UnavailableReason
}

function FreeScheduleContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialStudioId = searchParams.get('studio_id')
  const initialProgramId = searchParams.get('program_id')
  
  // UTMパラメータを保持
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
  const paymentType = searchParams.get('payment_type')

  // URLパラメータがある場合は初期化完了まで待つ
  const hasUrlParams = !!(initialStudioId && initialProgramId)
  
  // State for Selection Flow
  const [studios, setStudios] = useState<Studio[]>([])
  const [selectedStudio, setSelectedStudio] = useState<Studio | null>(null)
  
  const [programs, setPrograms] = useState<Program[]>([])
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null)
  
  const [studioRoomId, setStudioRoomId] = useState<number | null>(null)
  
  // 予約カテゴリ設定（studio_room_service）を保存
  const [studioRoomService, setStudioRoomService] = useState<ChoiceSchedule['studio_room_service'] | null>(null)

  // Calendar State - 今日を起点に7日間表示
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => startOfDay(new Date()))
  // 日付文字列 -> スケジュールのマップ（順序に依存しないように）
  const [scheduleMap, setScheduleMap] = useState<Map<string, ChoiceSchedule | null>>(new Map())
  const [loading, setLoading] = useState(true)
  const [initializing, setInitializing] = useState(hasUrlParams) // URLパラメータからの初期化中
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 1週間分の日付リスト
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i))

  // 1. Load Studios
  useEffect(() => {
    async function loadStudios() {
      try {
        const data = await getStudios()
        setStudios(data)
        
        // Initial Selection Logic
        if (initialStudioId) {
            const initial = data.find(s => s.id === parseInt(initialStudioId))
            if (initial) {
              await handleStudioSelect(initial, true) // URLからの初期化
            } else {
              setInitializing(false)
            }
        } else if (data.length === 1) {
            handleStudioSelect(data[0])
        } else {
            setInitializing(false)
        }
      } catch (err) {
        console.error(err)
        setError('店舗情報の読み込みに失敗しました')
        setInitializing(false)
      } finally {
        setLoading(false)
      }
    }
    loadStudios()
  }, [])

  // 2. Handle Studio Selection -> Load Programs & Find Room
  // 【パフォーマンス最適化】全てのAPIリクエストを並列実行、getChoiceScheduleをgetChoiceScheduleRangeに統合
  const handleStudioSelect = async (studio: Studio, isFromUrl: boolean = false) => {
    setSelectedStudio(studio)
    if (!isFromUrl) {
      setSelectedProgram(null)
      setStudioRoomId(null)
      setScheduleMap(new Map())
      setStudioRoomService(null)
    }
    
    try {
        // 現在時刻（日本時間）を取得
        const now = new Date()
        const todayStr = format(now, 'yyyy-MM-dd')
        const weekEndStr = format(addDays(now, 6), 'yyyy-MM-dd')
        
        // 【最適化】Rooms と Programs を並列取得
        const [roomsData, programsData] = await Promise.all([
          getStudioRooms(studio.id),
          getPrograms({
            studioId: studio.id,
            filterFullyConfigured: true
          })
        ])
        
        // CHOICEタイプの部屋を探す
        const choiceRooms = roomsData.filter(r => r.reservation_type === 'CHOICE')
        const candidateRooms = choiceRooms.length > 0 
          ? choiceRooms 
          : roomsData.filter(r => r.name.includes('Test') || r.id !== 5)
        
        if (candidateRooms.length === 0) {
            setError('予約可能な部屋が見つかりませんでした')
            return
        }
        
        // 【最適化】getChoiceScheduleRange で週間データを取得し、初日のデータで検証
        // getChoiceSchedule の代わりに使用（1回のAPIで7日分取得）
        const roomSchedules = await Promise.all(
          candidateRooms.map(async (room) => {
            try {
              // program_id は後で決まるので、ここでは none で取得
              const scheduleMap = await getChoiceScheduleRange(room.id, todayStr, weekEndStr)
              const todaySchedule = scheduleMap.get(todayStr)
              return { room, scheduleData: todaySchedule, scheduleMap }
            } catch (err) {
              console.error(`Failed to check room ${room.id}:`, err)
              return { room, scheduleData: null, scheduleMap: new Map() }
            }
          })
        )
        
        // 適用期間内の予約カテゴリを探す
        let validRoom: StudioRoom | null = null
        let validRoomService: ChoiceSchedule['studio_room_service'] | null = null
        let validScheduleMap: Map<string, ChoiceSchedule | null> = new Map()
        
        for (const { room, scheduleData, scheduleMap } of roomSchedules) {
          if (!scheduleData) continue
          const roomService = scheduleData.studio_room_service
            
            if (!roomService) continue
            
            // 適用期間のチェック（日付のみで比較）
            // start_date, end_dateがない場合は常に有効とみなす
            let isWithinPeriod = true
            if (roomService.start_date && roomService.end_date) {
              // 日付文字列で比較（yyyy-MM-dd形式）
              isWithinPeriod = todayStr >= roomService.start_date && todayStr <= roomService.end_date
            }
            
            if (isWithinPeriod) {
              validRoom = room
              validRoomService = roomService
            validScheduleMap = scheduleMap
              break
          }
        }
        
        if (!validRoom || !validRoomService) {
          setError('現在予約可能な期間の予約カテゴリがありません。この店舗は現在予約を受け付けていません。')
          setPrograms([])
          return
        }
        
        setStudioRoomId(validRoom.id)
        setStudioRoomService(validRoomService)
        
        // 選択可能プログラムでフィルタリング（SELECTED の場合）
        let filteredPrograms = programsData
        if (validRoomService.selectable_program_type === 'SELECTED' && validRoomService.selectable_program_details) {
          const selectableProgramIds = new Set(validRoomService.selectable_program_details.map(p => p.program_id))
          filteredPrograms = programsData.filter(p => selectableProgramIds.has(p.id))
        }
        
        setPrograms(filteredPrograms)
        
        // URLパラメータでプログラムが指定されている場合は自動選択
        if (initialProgramId) {
          const initialProgram = filteredPrograms.find(p => p.id === parseInt(initialProgramId))
          if (initialProgram) {
            setSelectedProgram(initialProgram)
            // 既に取得したスケジュールマップを設定（再取得不要）
            // ただしprogram_idが違うので、useEffectで再取得される
          }
        }

    } catch (err) {
        console.error(err)
        setError('メニューの読み込みに失敗しました')
    } finally {
        // URLからの初期化が完了したらフラグをオフに
        if (isFromUrl) {
          setInitializing(false)
        }
    }
  }

  // 3. Handle Program Selection -> Trigger Calendar Load
  const handleProgramSelect = (program: Program) => {
      setSelectedProgram(program)
  }

  // 4. Load Schedule when Room & Program are ready
  // リクエストIDを追跡して、古いリクエストの結果を無視する
  const latestRequestIdRef = useRef(0)
  
  useEffect(() => {
    if (!studioRoomId || !selectedProgram) return

    // このeffectが実行される時点の日付をキャプチャ
    const dateFrom = format(currentWeekStart, 'yyyy-MM-dd')
    const dateTo = format(addDays(currentWeekStart, 6), 'yyyy-MM-dd')
    
    // リクエストIDをインクリメント
    latestRequestIdRef.current += 1
    const thisRequestId = latestRequestIdRef.current

    async function loadWeeklySchedule() {
      try {
        setScheduleLoading(true)
        
        // 1回のAPIコールで7日分のスケジュールを取得（最適化）
        // program_idを渡して1日あたりの予約数も取得
        const newScheduleMap = await getChoiceScheduleRange(studioRoomId!, dateFrom, dateTo, selectedProgram!.id)
        
        // このリクエストが最新でなければ、状態を更新しない
        if (thisRequestId !== latestRequestIdRef.current) {
          return
        }
        
        setScheduleMap(newScheduleMap)
      } catch (err) {
        console.error(err)
        // Don't set global error to avoid blocking UI, just show empty calendar
      } finally {
        // このリクエストが最新の場合のみローディング状態を解除
        if (thisRequestId === latestRequestIdRef.current) {
          setScheduleLoading(false)
        }
      }
    }
    loadWeeklySchedule()
  }, [studioRoomId, selectedProgram, currentWeekStart])


  // スタッフがスタジオに紐付けられているかチェック
  const isInstructorAssociatedWithStudio = (instructorId: number, schedule: ChoiceSchedule | null): boolean => {
    if (!schedule) return false
    
    const studioId = schedule.studio_id
    if (!studioId) return true  // スタジオIDがない場合は制限なし
    
    const instructorStudioMap = schedule.instructor_studio_map
    if (!instructorStudioMap) return true  // マップがない場合は制限なし
    
    // JSONではキーが文字列になるため、文字列に変換してアクセス
    const instructorStudioIds = instructorStudioMap[String(instructorId)]
    
    // hacomonoのロジック: studio_idsが未設定または空の場合は「全店舗対応可能」
    if (!instructorStudioIds || instructorStudioIds.length === 0) {
      return true  // 空配列 = 制限なし = 全店舗OK
    }
    
    // 特定のスタジオに紐付けられている場合は、そのスタジオに含まれているかチェック
    return instructorStudioIds.includes(studioId)
  }

  // スタッフが選択可能かチェックするヘルパー関数
  const isInstructorSelectable = (instructorId: number): boolean => {
    const details = selectedProgram?.selectable_instructor_details
    if (!details || details.length === 0) return true  // 設定なし = 全員選択可能
    
    // 最初の設定を使用（通常は1つのみ）
    const detail = details[0]
    if (detail.type === 'ALL' || detail.type === 'RANDOM_ALL') return true  // 全てから選択可能
    if (detail.type === 'SELECTED' || detail.type === 'FIXED' || detail.type === 'RANDOM_SELECTED') {
      // items配列からinstructor_idを抽出してチェック
      const selectableIds = detail.items?.map(item => item.instructor_id) ?? []
      return selectableIds.includes(instructorId)
    }
    return true
  }

  // インターバルを考慮した予約済み判定
  // 休憩ブロック（reservation_typeがBREAKやBLOCKなど）も予約不可として扱う
  const isBlockedByInterval = (
    instructorId: number,
    cellTime: Date,
    cellEndTime: Date,
    reservedSlots: Array<{ entity_id: number; start_at: string; end_at: string; reservation_type?: string }>
  ): boolean => {
    const beforeInterval = selectedProgram?.before_interval_minutes || 0
    const afterInterval = selectedProgram?.after_interval_minutes || 0
    
    return reservedSlots.some(res => {
      if (res.entity_id !== instructorId) return false
      
      const resStart = parseISO(res.start_at)
      const resEnd = parseISO(res.end_at)
      
      // 休憩ブロックの場合はインターバルを考慮せず、そのままブロック
      const reservationType = (res.reservation_type || '').toUpperCase()
      const isBlock = ['BREAK', 'BLOCK', 'REST', '休憩', 'ブロック'].includes(reservationType)
      
      let blockStart: Date
      let blockEnd: Date
      
      if (isBlock) {
        // 休憩ブロックの場合は、その時間帯をそのままブロック
        blockStart = resStart
        blockEnd = resEnd
      } else {
        // インターバルを考慮したブロック範囲
        // 予約の before_interval 分前から after_interval 分後までがブロック
        blockStart = new Date(resStart.getTime() - beforeInterval * 60000)
        blockEnd = new Date(resEnd.getTime() + afterInterval * 60000)
      }
      
      // このスロットがブロック範囲と重複するか
      return cellTime < blockEnd && cellEndTime > blockStart
    })
  }

  // 設備の予約数と完全ブロック状態をカウント
  const getResourceAvailability = (
    resourceId: number,
    checkStartTime: Date,
    checkEndTime: Date,
    reservedResources: Array<{ entity_id: number; start_at: string; end_at: string; reservation_type?: string }>
  ): { reservationCount: number; isBlocked: boolean } => {
    let reservationCount = 0
    let isBlocked = false
    
    reservedResources.forEach(res => {
      if (res.entity_id !== resourceId) return
      
      const resStart = parseISO(res.start_at)
      const resEnd = parseISO(res.end_at)
      
      // 時間が重複するか
      if (checkStartTime < resEnd && checkEndTime > resStart) {
        // 予定ブロック（SHIFT_SLOT）の場合は完全ブロック
        const reservationType = (res.reservation_type || '').toUpperCase()
        if (['BREAK', 'BLOCK', 'REST', 'SHIFT_SLOT'].includes(reservationType)) {
          isBlocked = true
        } else {
          // 通常の予約はカウント
          reservationCount++
        }
      }
    })
    
    return { reservationCount, isBlocked }
  }

  // 指定時間帯に利用可能な設備があるかチェック（terms を考慮）
  // terms: 時間帯ごとに異なる設備を使用する設定
  // 例: 60分コースで前半20分は設備A、後半40分は設備Bを使用する場合
  const hasAvailableResource = (
    cellTime: Date,
    cellEndTime: Date,
    schedule: ChoiceSchedule | null
  ): boolean => {
    const details = selectedProgram?.selectable_resource_details
    if (!details || details.length === 0) return true  // 設備不要なプログラム
    
    const reservedResources = schedule?.reservation_assign_resource || []
    const resourcesInfo = schedule?.resources_info || {}
    const serviceMinutes = selectedProgram?.service_minutes || selectedProgram?.duration || 60
    
    // 各 selectable_resource_details 要素について、その時間帯で設備が空いているかチェック
    for (let detailIdx = 0; detailIdx < details.length; detailIdx++) {
      const detail = details[detailIdx]
      
      // ALL, RANDOM_ALL の場合は設備チェック不要
      if (detail.type === 'ALL' || detail.type === 'RANDOM_ALL') continue
      
      // 選択可能設備IDを取得
      const selectableIds = detail.items?.map(item => item.resource_id).filter((id): id is number => !!id) ?? []
      if (selectableIds.length === 0) return false  // 設備が必要だが選択可能なものがない
      
      // terms がある場合、その時間帯でチェック。なければ（空配列含む）コース全体
      const terms = (detail.terms && detail.terms.length > 0) 
        ? detail.terms 
        : [{ start_minutes: 0, end_minutes: serviceMinutes }]
      
      // この detail の全ての terms について、いずれかの設備が空いているかチェック
      for (let termIdx = 0; termIdx < terms.length; termIdx++) {
        const term = terms[termIdx]
        const termStartTime = new Date(cellTime.getTime() + term.start_minutes * 60 * 1000)
        const termEndTime = new Date(cellTime.getTime() + term.end_minutes * 60 * 1000)
        
        // この term の時間帯で空いている設備を探す
        let hasAvailableInTerm = false
        
        for (let i = 0; i < selectableIds.length; i++) {
          const resourceId = selectableIds[i]
          
          // 設備がこの店舗に紐づいているかチェック
          const resourceInfo = resourcesInfo[String(resourceId)]
          if (!resourceInfo) continue
          
          const { reservationCount, isBlocked } = getResourceAvailability(
            resourceId, termStartTime, termEndTime, reservedResources
          )
          
          // 予定ブロックで完全ブロックされている場合はスキップ
          if (isBlocked) continue
          
          // 同時予約可能数を取得（デフォルト1）
          const maxReservableNum = resourceInfo.max_cc_reservable_num || 1
          
          // 予約数が同時予約可能数未満なら利用可能
          if (reservationCount < maxReservableNum) {
            hasAvailableInTerm = true
            break
          }
        }
        
        // この term で空いている設備がなければ、予約不可
        if (!hasAvailableInTerm) return false
      }
    }
    
    // 全ての detail/term で空きがあれば予約可能
    return true
  }

  // Grid Generation Logic (Same as before)
  const generateGrid = () => {
    if (scheduleMap.size === 0) return []

    let minStartHour = 9
    let maxEndHour = 21
    let interval = 30

    // マップの全スケジュールをチェック
    scheduleMap.forEach(schedule => {
      if (schedule?.studio_room_service?.schedule_nick) {
        interval = schedule.studio_room_service.schedule_nick
      }
      schedule?.shift_studio_business_hour?.forEach(bh => {
        if (!bh.is_holiday) {
          const start = parseISO(bh.start_at).getHours()
          const end = parseISO(bh.end_at).getHours()
          if (start < minStartHour) minStartHour = start
          if (end > maxEndHour) maxEndHour = end + 1
        }
      })
    })

    // コースの所要時間（分）: プログラムから取得、なければintervalを使用
    const serviceMinutes = selectedProgram?.service_minutes || interval
    
    // 表示間隔はhacomonoの予約カテゴリ設定（schedule_nick）を使用
    // これにより店舗ごとに異なる時間刻みに対応（例: 15分、30分など）
    const displayInterval = interval
    
    // 予約締切時間（開始X分前まで）: プログラムから取得、デフォルトは0（直前まで可）
    const reservableToMinutes = selectedProgram?.reservable_to_minutes ?? 0

    const rows = []
    let currentTime = new Date()
    currentTime.setHours(minStartHour, 0, 0, 0)
    const endTime = new Date()
    endTime.setHours(maxEndHour, 0, 0, 0)

    while (currentTime < endTime) {
      const timeLabel = format(currentTime, 'HH:mm')
      const rowSlots: GridSlot[] = []

      weekDates.forEach((date) => {
        // 日付文字列をキーにしてスケジュールを取得（順序に依存しない）
        const dateStr = format(date, 'yyyy-MM-dd')
        const schedule = scheduleMap.get(dateStr) || null
        let isAvailable = false
        let isHoliday = true
        let unavailableReason: UnavailableReason = 'holiday' // デフォルト: 休業日

        // 予約可能範囲のチェック: 30分後以降 〜 14日後まで
        const now = new Date()
        const cellTime = new Date(date)
        cellTime.setHours(parseInt(timeLabel.split(':')[0]), parseInt(timeLabel.split(':')[1]), 0, 0)
        
        const minTime = new Date(now.getTime() + 30 * 60 * 1000) // 30分後
        const maxTime = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) // 14日後
        
        // 予約締切時間のチェック（開始X分前まで）
        const deadlineTime = new Date(cellTime.getTime() - reservableToMinutes * 60000)
        
        // コース終了時刻を計算（表示間隔ではなく、コースの所要時間を使用）
        const cellEndTime = new Date(cellTime.getTime() + serviceMinutes * 60000)
        
        // 1日の予約上限チェック
        // hacomonoでは 0 = 「0件まで予約可能」（つまり予約不可）、null = 上限なし
        const maxReservableNumAtDay = selectedProgram?.max_reservable_num_at_day
        const programReservationCount = schedule?.program_reservation_count ?? 0
        // maxReservableNumAtDay が 0 の場合も予約不可（hacomonoの仕様）
        const isDailyLimitReached = maxReservableNumAtDay !== null && maxReservableNumAtDay !== undefined && programReservationCount >= maxReservableNumAtDay
        
        // 時間範囲チェックを先に行う
        if (cellTime < minTime) {
          unavailableReason = 'too_soon'
        } else if (cellTime > maxTime) {
          unavailableReason = 'too_far'
        } else if (now > deadlineTime) {
          // 予約締切を過ぎている
          unavailableReason = 'deadline_passed'
        } else if (isDailyLimitReached) {
          // 1日の予約上限に達している
          unavailableReason = 'daily_limit_reached'
        } else if (schedule) {
          const businessHour = schedule.shift_studio_business_hour?.find(
            bh => !bh.is_holiday && isSameDay(parseISO(bh.date), date)
          )

          if (businessHour) {
            isHoliday = false
            const bhStart = parseISO(businessHour.start_at)
            const bhEnd = parseISO(businessHour.end_at)

            // 営業時間内にコースが収まるかチェック
            if (cellTime >= bhStart && cellEndTime <= bhEnd) {
              const shiftInstructors = schedule.shift_instructor || []
              const reservedSlots = schedule.reservation_assign_instructor || []
              
              let availableCount = 0
              let hasInstructorInSlot = false
              let hasSelectableInstructor = false
              let isIntervalBlocked = false
              
              // 重複するinstructor_idを除外（ユニークなスタッフのみ）
              const uniqueInstructorIds = new Set<number>()
              
              for (const instructor of shiftInstructors) {
                  // 同じinstructor_idは1回だけ処理
                  if (uniqueInstructorIds.has(instructor.instructor_id)) continue
                  uniqueInstructorIds.add(instructor.instructor_id)
                  
                  const instStart = parseISO(instructor.start_at)
                  const instEnd = parseISO(instructor.end_at)
                  
                  // スタッフのシフト時間内にコースが収まるかチェック
                  if (cellTime >= instStart && cellEndTime <= instEnd) {
                      hasInstructorInSlot = true
                      
                      // スタッフがスタジオに紐付けられているかチェック
                      if (!isInstructorAssociatedWithStudio(instructor.instructor_id, schedule)) {
                        continue  // スタジオに紐付けられていないスタッフはスキップ
                      }
                      
                      // 選択可能スタッフかチェック（プログラム設定）
                      if (!isInstructorSelectable(instructor.instructor_id)) {
                        continue  // 選択不可のスタッフはスキップ
                      }
                      hasSelectableInstructor = true
                      
                      // インターバルを考慮した予約済みチェック
                      const isBlocked = isBlockedByInterval(
                        instructor.instructor_id,
                        cellTime,
                        cellEndTime,
                        reservedSlots
                      )
                      
                      if (isBlocked) {
                        isIntervalBlocked = true
                      } else {
                        availableCount++
                      }
                  }
              }
              
              if (availableCount > 0) {
                // スタッフは空いている → 設備もチェック
                if (hasAvailableResource(cellTime, cellEndTime, schedule)) {
                  isAvailable = true
                  unavailableReason = 'available'
                } else {
                  // スタッフは空いているが設備がない
                  unavailableReason = 'no_available_resource'
                }
              } else if (!hasSelectableInstructor && hasInstructorInSlot) {
                // シフトに入っているが選択可能なスタッフがいない
                unavailableReason = 'no_selectable_staff'
              } else if (isIntervalBlocked) {
                // インターバルでブロックされている
                unavailableReason = 'interval_blocked'
              } else if (hasInstructorInSlot) {
                // スタッフがいるが全員予約済み = 満席
                unavailableReason = 'fully_booked'
              } else {
                // スタッフがシフトに入っていない = 営業時間外
                unavailableReason = 'outside_hours'
              }
            } else {
              // 営業時間外（コースが営業時間を超える）
              unavailableReason = 'outside_hours'
            }
          } else {
            // 休業日
            unavailableReason = 'holiday'
          }
        }

        rowSlots.push({
          date: date,
          time: timeLabel,
          startAt: `${format(date, 'yyyy-MM-dd')} ${timeLabel}:00.000`,
          available: isAvailable,
          isHoliday: isHoliday,
          unavailableReason: unavailableReason
        })
      })

      rows.push({ time: timeLabel, slots: rowSlots })
      currentTime = new Date(currentTime.getTime() + displayInterval * 60000)
    }
    
    return rows
  }

  const allGridRows = generateGrid()
  
  // 営業時間外の行を除外（全日が outside_hours または holiday の行は表示しない）
  let gridRows = allGridRows.filter(row => {
    // 全スロットが営業時間外または休業日なら除外
    const allOutsideOrHoliday = row.slots.every(slot => 
      slot.unavailableReason === 'outside_hours' || slot.unavailableReason === 'holiday'
    )
    return !allOutsideOrHoliday
  })

  // 9:00〜10:00の時間帯に予約可能なスロットが1つもない場合、その時間帯の行を非表示にする
  const isEarlyMorningTime = (time: string) => {
    const hour = parseInt(time.split(':')[0])
    return hour === 9  // 09:00, 09:15, 09:30, 09:45 など
  }

  const hasAvailableInEarlyMorning = gridRows.some(row => {
    if (!isEarlyMorningTime(row.time)) return false
    return row.slots.some(slot => slot.available)
  })

  if (!hasAvailableInEarlyMorning) {
    gridRows = gridRows.filter(row => !isEarlyMorningTime(row.time))
  }

  // 休業日を判定（その日の全スロットが holiday の場合は休業日）
  const isDateHoliday = (dateIndex: number): boolean => {
    if (gridRows.length === 0) return true
    // 全ての行で、その日のスロットが holiday かチェック
    return gridRows.every(row => {
      const slot = row.slots[dateIndex]
      return slot?.unavailableReason === 'holiday'
    })
  }

  // 表示する日付のインデックス（休業日を除外）
  const displayDateIndices = weekDates
    .map((_, index) => index)
    .filter(index => !isDateHoliday(index))

  // 予約可否チェック中のスロット
  const [checkingSlot, setCheckingSlot] = useState<string | null>(null)
  const [slotError, setSlotError] = useState<string | null>(null)

  const handleSlotSelect = async (slot: GridSlot) => {
    if (!slot.available || !selectedProgram || !studioRoomId) return

    // 事前チェックは行わず、直接予約フォームへ進む
    // （実際の予約可否は予約実行時にhacomonoが判定）
    
    // GTMイベント: 自由枠日時選択
    sendGTMEvent({
      event: 'slot_select',
      reservation_type: 'free',
      studio_id: selectedStudio?.id,
      studio_name: selectedStudio?.name || '',
      program_id: selectedProgram?.id,
      program_name: selectedProgram?.name || '',
      slot_date: format(slot.date, 'yyyy-MM-dd'),
      slot_time: slot.time,
    })

    const params = new URLSearchParams()
    params.set('studio_room_id', studioRoomId.toString())
    params.set('start_at', slot.startAt)
    if (selectedStudio) params.set('studio_id', selectedStudio.id.toString())
    if (selectedProgram) params.set('program_id', selectedProgram.id.toString())
    
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
    
    // 支払い方法を引き継ぎ
    if (paymentType) params.set('payment_type', paymentType)
    
    router.push(`/free-booking?${params.toString()}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSlotSelectWithCheck = async (slot: GridSlot) => {
    if (!slot.available || !selectedProgram || !studioRoomId) return

    // 既にチェック中の場合は無視
    if (checkingSlot) return

    setCheckingSlot(slot.startAt)
    setSlotError(null)

    try {
      // hacomonoに予約可否を事前確認（現在未使用）
      const result = await checkReservability({
        studio_room_id: studioRoomId,
        program_id: selectedProgram.id,
        start_at: slot.startAt,
      })

      if (!result.is_reservable) {
        setSlotError(result.error_message || 'この時間帯は現在予約できません。別の時間帯をお選びください。')
        setCheckingSlot(null)
        return
      }

      const params = new URLSearchParams()
      params.set('studio_room_id', studioRoomId.toString())
      params.set('start_at', slot.startAt)
      if (selectedStudio) params.set('studio_id', selectedStudio.id.toString())
      if (selectedProgram) params.set('program_id', selectedProgram.id.toString())
      
      router.push(`/free-booking?${params.toString()}`)
    } catch (err) {
      console.error('Failed to check reservability:', err)
      setSlotError('予約可否の確認中にエラーが発生しました。')
    } finally {
      setCheckingSlot(null)
    }
  }

  // 7日単位でナビゲーション（今日より前には戻れない、14日後までしか進めない）
  const today = startOfDay(new Date())
  const maxStartDate = addDays(today, 7) // 最大でも7日後を起点に（14日後まで表示）
  
  const handlePrevWeek = () => {
    const newStart = subDays(currentWeekStart, 7)
    // 今日より前には戻れない
    if (newStart >= today) {
      setCurrentWeekStart(newStart)
    } else {
      setCurrentWeekStart(today)
    }
  }
  
  const handleNextWeek = () => {
    const newStart = addDays(currentWeekStart, 7)
    // 14日後を超えないように
    if (newStart <= maxStartDate) {
      setCurrentWeekStart(newStart)
    }
  }
  
  // 前へボタンを無効にするか
  const canGoPrev = currentWeekStart > today
  // 次へボタンを無効にするか
  const canGoNext = currentWeekStart < maxStartDate

  // URLパラメータからの初期化中、または店舗データローディング中
  if (loading || initializing) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-accent-600">
            {initializing ? 'スケジュールを読み込み中...' : '読み込み中...'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-2 py-6 sm:px-6">
      {/* Steps Indicator - Step 1 */}
      <div className="flex items-center justify-center mb-10 text-sm font-medium text-accent-400">
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center font-bold">1</div>
          <span className="ml-2 text-primary-700 font-bold">日時選択</span>
        </div>
        <div className="w-12 h-0.5 bg-gray-200 mx-4"></div>
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold">2</div>
          <span className="ml-2">お客様情報</span>
        </div>
        <div className="w-12 h-0.5 bg-gray-200 mx-4"></div>
        <div className="flex items-center">
          <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold">3</div>
          <span className="ml-2">確認</span>
        </div>
      </div>

      {/* Selection Area */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Studio Selection */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ご希望の店舗 <span className="text-red-500">*</span></label>
                {initialStudioId && selectedStudio ? (
                  // URLパラメータで指定されている場合は固定表示
                  <div className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 font-medium">
                    {selectedStudio.name}
                  </div>
                ) : (
                  <select 
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      value={selectedStudio?.id || ''}
                      onChange={(e) => {
                          const studio = studios.find(s => s.id === parseInt(e.target.value))
                          if (studio) handleStudioSelect(studio)
                      }}
                  >
                      <option value="">店舗を選択してください</option>
                      {studios.map(studio => (
                          <option key={studio.id} value={studio.id}>{studio.name}</option>
                      ))}
                  </select>
                )}
            </div>

            {/* Program Selection */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ご希望のコース <span className="text-red-500">*</span></label>
                {initialProgramId && selectedProgram ? (
                  // URLパラメータで指定されている場合は固定表示
                  <div className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 font-medium">
                    {selectedProgram.name} ({selectedProgram.service_minutes || selectedProgram.duration || '?'}分)
                  </div>
                ) : (
                  <select 
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
                      value={selectedProgram?.id || ''}
                      onChange={(e) => {
                          const program = programs.find(p => p.id === parseInt(e.target.value))
                          if (program) handleProgramSelect(program)
                      }}
                      disabled={!selectedStudio}
                  >
                      <option value="">コースを選択してください</option>
                      {programs.map(program => (
                          <option key={program.id} value={program.id}>
                              {program.name} ({program.service_minutes || program.duration || '?'}分)
                          </option>
                      ))}
                  </select>
                )}
            </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6">
            {error}
        </div>
      )}

      {/* Calendar Area */}
      {selectedStudio && selectedProgram && (
        <div className="animate-fade-in">
            {/* Header & Navigation */}
            <div className="flex flex-col sm:flex-row items-center justify-between mb-4 gap-4">
                <h3 className="text-lg font-bold text-gray-800">ご希望の日時 <span className="text-red-500 text-sm font-normal ml-1">*</span></h3>
                <div className="flex items-center gap-4 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
                    <button 
                      onClick={handlePrevWeek} 
                      disabled={!canGoPrev}
                      className={`p-2 rounded-md transition-colors ${canGoPrev ? 'hover:bg-gray-100 text-primary-600' : 'text-gray-300 cursor-not-allowed'}`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="font-bold text-base min-w-[120px] text-center">
                        {format(currentWeekStart, 'M/d')} 〜 {format(addDays(currentWeekStart, 6), 'M/d')}
                    </span>
                    <button onClick={handleNextWeek} className="p-2 hover:bg-gray-100 rounded-md transition-colors text-primary-600">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>

            {/* Calendar Grid */}
            {scheduleLoading ? (
                <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                    <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
                </div>
            ) : (
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
                                let tooltip = ""
                                
                                if (slot.available) {
                                    content = <span className="text-primary-500 text-xl font-bold">◎</span>
                                    cellClass = "cursor-pointer hover:bg-primary-50 active:bg-primary-100"
                                    tooltip = "予約可能"
                                } else {
                                    switch (slot.unavailableReason) {
                                        case 'holiday':
                                            content = <span className="text-gray-200 text-sm">-</span>
                                            cellClass = "bg-gray-100/50"
                                            tooltip = "休業日"
                                            break
                                        case 'outside_hours':
                                            content = <span className="text-gray-300 text-sm">-</span>
                                            cellClass = "bg-gray-50/50"
                                            tooltip = "営業時間外"
                                            break
                                        case 'fully_booked':
                                            content = <span className="text-red-400 text-xl">×</span>
                                            cellClass = "bg-red-50/50"
                                            tooltip = "満席"
                                            break
                                        case 'too_soon':
                                            content = <span className="text-amber-300 text-sm">-</span>
                                            cellClass = "bg-amber-50/30"
                                            tooltip = "受付時間前（30分以内）"
                                            break
                                        case 'too_far':
                                            content = <span className="text-gray-200 text-sm">-</span>
                                            cellClass = "bg-gray-50/30"
                                            tooltip = "受付期間外（14日後以降）"
                                            break
                                        case 'deadline_passed':
                                            content = <span className="text-orange-300 text-sm">-</span>
                                            cellClass = "bg-orange-50/30"
                                            tooltip = "予約締切を過ぎています"
                                            break
                                        case 'interval_blocked':
                                            content = <span className="text-purple-400 text-xl">×</span>
                                            cellClass = "bg-purple-50/50"
                                            tooltip = "前後の予約との間隔が必要です"
                                            break
                                        case 'no_selectable_staff':
                                            content = <span className="text-gray-400 text-xl">×</span>
                                            cellClass = "bg-gray-100/50"
                                            tooltip = "対応可能なスタッフがいません"
                                            break
                                        case 'no_available_resource':
                                            content = <span className="text-orange-400 text-xl">×</span>
                                            cellClass = "bg-orange-50/50"
                                            tooltip = "設備が使用中です"
                                            break
                                        case 'daily_limit_reached':
                                            content = <span className="text-rose-400 text-xl">×</span>
                                            cellClass = "bg-rose-50/50"
                                            tooltip = "1日の予約上限に達しています"
                                            break
                                        default:
                                            tooltip = "予約不可"
                                    }
                                }

                                return (
                                    <td
                                        key={slot.startAt}
                                        onClick={() => handleSlotSelect(slot)}
                                        className={`p-2 border-b border-r border-gray-100 text-center transition-all h-12 ${cellClass} group relative`}
                                        title={tooltip}
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
            )}
            
            {/* Error Message */}
            {slotError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">⚠️</div>
                  <div>
                    <p className="font-bold text-red-800 mb-1">予約できません</p>
                    <p className="text-red-700 text-sm">{slotError}</p>
                  </div>
                  <button 
                    onClick={() => setSlotError(null)}
                    className="ml-auto text-red-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Checking Overlay */}
            {checkingSlot && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
                <p className="text-blue-700">予約可否を確認中...</p>
              </div>
            )}

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-4 justify-center text-sm text-gray-600">
                <div className="flex items-center gap-1">
                    <span className="text-primary-500 font-bold text-lg">◎</span> 予約可能
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-red-400 text-lg">×</span> 満席
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-purple-400 text-lg">×</span> 間隔調整中
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-orange-400 text-lg">×</span> 設備使用中
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-gray-300">-</span> 営業時間外
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-gray-200">-</span> 休業日
                </div>
            </div>
        </div>
      )}
      
      {!selectedProgram && !loading && (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300 mt-6">
              <p className="text-gray-500">店舗とコースを選択すると、予約可能な日時が表示されます</p>
          </div>
      )}
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
      <FreeScheduleContent />
    </Suspense>
  )
}
