import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { blocks, tasks, timeEntries, people, meetings } = req.body

  const errors: string[] = []

  // --- work_blocks ---
  if (blocks?.length) {
    const rows = blocks.map((b: any) => ({
      id: b.id,
      name: b.name,
      icon: b.icon ?? '',
      color: b.color ?? '',
      pastel_color: b.pastelColor ?? '',
      is_active: b.isActive ?? true,
      order: b.order ?? 0,
    }))
    const { error } = await supabase.from('work_blocks').upsert(rows, { onConflict: 'id' })
    if (error) errors.push(`work_blocks: ${error.message}`)
  }

  // --- tasks ---
  if (tasks && typeof tasks === 'object') {
    // Ordenar: primero tareas raíz, luego subtareas (evitar foreign key constraint)
    const sortedTasks = Object.values(tasks).sort((a: any, b: any) => {
      if (!a.parentTaskId && b.parentTaskId) return -1;
      if (a.parentTaskId && !b.parentTaskId) return 1;
      return 0;
    });
    const rows = sortedTasks.map((t: any) => ({
      id: t.id,
      block_id: t.blockId,
      parent_task_id: t.parentTaskId ?? null,
      template_id: t.templateId ?? null,
      instance_date: t.instanceDate ?? null,
      title: t.title ?? '',
      notes: t.notes ?? '',
      priority: t.priority ?? 'media',
      status: t.status ?? 'pending',
      due_date: t.dueDate ?? null,
      due_time: t.dueTime ?? null,
      estimated_minutes: t.estimatedMinutes ?? 0,
      tags: t.tags ?? [],
      task_type: t.taskType ?? null,
      is_template: t.isTemplate ?? false,
      is_exception: t.isException ?? false,
      is_deleted: t.isDeleted ?? false,
      is_expanded: t.isExpanded ?? false,
      order: t.order ?? 0,
      delegation: t.delegation ?? null,
      recurrence: t.recurrence ?? null,
      created_at: t.createdAt ?? new Date().toISOString(),
      modified_at: t.modifiedAt ?? new Date().toISOString(),
    }))

    // Upsert en lotes de 500 para no superar límites de Supabase
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from('tasks')
        .upsert(rows.slice(i, i + 500), { onConflict: 'id' })
      if (error) { errors.push(`tasks batch ${i}: ${error.message}`); break }
    }

    // task_subtasks: reconstruir relaciones padre→hijo
    const subtaskRows: { task_id: string; subtask_id: string; order: number }[] = []
    Object.values(tasks).forEach((t: any) => {
      if (t.subtasks?.length) {
        t.subtasks.forEach((sid: string, idx: number) => {
          subtaskRows.push({ task_id: t.id, subtask_id: sid, order: idx })
        })
      }
    })
    if (subtaskRows.length) {
      // Borrar las relaciones existentes de los padres que vamos a actualizar
      const parentIds = [...new Set(subtaskRows.map(r => r.task_id))]
      for (let i = 0; i < parentIds.length; i += 500) {
        await supabase
          .from('task_subtasks')
          .delete()
          .in('task_id', parentIds.slice(i, i + 500))
      }
      for (let i = 0; i < subtaskRows.length; i += 500) {
        const { error } = await supabase
          .from('task_subtasks')
          .insert(subtaskRows.slice(i, i + 500))
        if (error) { errors.push(`task_subtasks batch ${i}: ${error.message}`); break }
      }
    }
  }

  // --- time_entries ---
  if (timeEntries?.length) {
    const rows = timeEntries.map((e: any) => ({
      id: e.id,
      task_id: e.taskId,
      subtask_id: e.subtaskId ?? null,
      duration: e.duration,
      date: e.date,
      note: e.note ?? null,
      source: e.source ?? 'manual',
    }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from('time_entries')
        .upsert(rows.slice(i, i + 500), { onConflict: 'id' })
      if (error) { errors.push(`time_entries batch ${i}: ${error.message}`); break }
    }
  }

  // --- persons ---
  if (people?.length) {
    const rows = people.map((p: any) => ({
      id: p.id,
      name: p.name,
      created_at: p.createdAt ?? new Date().toISOString(),
    }))
    const { error } = await supabase.from('persons').upsert(rows, { onConflict: 'id' })
    if (error) errors.push(`persons: ${error.message}`)
  }

  // --- delegation_meetings ---
  if (meetings?.length) {
    const meetingRows = meetings.map((m: any) => ({
      id: m.id,
      person_id: m.personId,
      date: m.date,
      notes: m.notes ?? '',
      created_at: m.createdAt ?? new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('delegation_meetings')
      .upsert(meetingRows, { onConflict: 'id' })
    if (error) errors.push(`delegation_meetings: ${error.message}`)
  }

  if (errors.length) {
    console.error('[SYNC] Errores parciales:', errors)
    return res.status(207).json({ ok: false, errors })
  }

  return res.status(200).json({ ok: true })
}
