import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    return res.status(500).json({ 
      error: 'Missing env vars', 
      hasUrl: !!url, 
      hasKey: !!key 
    })
  }

  try {
    const supabase = createClient(url, key)
    const { data, error } = await supabase
      .from('work_blocks')
      .select('*')
      .eq('is_active', true)
      .order('order', { ascending: true })

    if (error) return res.status(500).json({ error: error.message, details: error })
    return res.status(200).json({ projects: data })
  } catch (e: any) {
    return res.status(500).json({ error: e.message, stack: e.stack })
  }
}