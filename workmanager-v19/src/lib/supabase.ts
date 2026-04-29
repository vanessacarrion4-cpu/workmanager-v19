 import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://yewfmfoijidvrxvbrsdv.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlld2ZtZm9samlkdnJ4dmJyc2R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzI4MDgsImV4cCI6MjA5MjgwODgwOH0.8kfnEdbgsxMjd5hlmLkE8TD8LS52aU4uKpnti4_Gosc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
