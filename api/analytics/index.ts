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
    // Get all tasks
    const { data: allTasks, error: allError } = await supabase
      .from('tasks')
      .select('*')

    if (allError) return res.status(500).json({ error: allError.message })

    // Calculate statistics
    const total = allTasks?.length || 0
    const completed = allTasks?.filter(t => t.status === 'completed').length || 0
    const pending = total - completed
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

    // Group by priority
    const byPriority = {
      alta: allTasks?.filter(t => t.priority === 'alta' && t.status === 'pending').length || 0,
      media: allTasks?.filter(t => t.priority === 'media' && t.status === 'pending').length || 0,
      baja: allTasks?.filter(t => t.priority === 'baja' && t.status === 'pending').length || 0,
    }

    // Group by project
    const byProject: Record<string, number> = {}
    allTasks?.forEach(task => {
      if (task.status === 'pending') {
        byProject[task.block_id] = (byProject[task.block_id] || 0) + 1
      }
    })

    return res.status(200).json({
      total,
      completed,
      pending,
      completionRate,
      byPriority,
      byProject
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
