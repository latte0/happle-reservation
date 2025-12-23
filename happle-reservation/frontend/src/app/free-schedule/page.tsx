'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function FreeSchedulePage() {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  return null
}
