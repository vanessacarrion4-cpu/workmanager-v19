import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method === 'GET') {
    const { blockId, status, priority } = req.query
    let query = supabase.from('tasks').select('*')
    if (blockId) query = query.eq('block_id', blockId)
    if (status) query = query.eq('status', status)
    if (priority) query = query.eq('priority', priority)
    const { data, error } = await query.order('order', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ tasks: data })
  }

  if (req.method === 'POST') {
    const t = req.body
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        id: t.id,
        block_id: t.block
