'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function FreeScheduleRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // URLパラメータを保持してTOPページにリダイレクト
    const params = new URLSearchParams()
    searchParams.forEach((value, key) => {
      params.set(key, value)
    })
    const queryString = params.toString()
    router.replace(`/${queryString ? `?${queryString}` : ''}`)
  }, [router, searchParams])

  return null
}

export default function FreeSchedulePage() {
  return (
    <Suspense fallback={null}>
      <FreeScheduleRedirect />
    </Suspense>
  )
}
