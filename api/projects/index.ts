 
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('work_blocks')
      .select('*')
      .eq('is_active', true)
      .order('order', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ projects: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}