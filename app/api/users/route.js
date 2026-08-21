import { db as supabase } from '../../../lib/db';
import { demoGuard } from '../../../lib/api-guard';

export async function POST(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const { name } = await request.json();
    if (!name || name.trim().length < 1) {
      return Response.json({ error: 'Name is required' }, { status: 400 });
    }

    // Check if a user with this name already exists — link to them instead of creating duplicate
    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .ilike('name', name.trim())
      .limit(1)
      .single();

    if (existing) {
      return Response.json({ user: existing });
    }

    // Create new user
    const { data, error } = await supabase
      .from('users')
      .insert([{ name: name.trim() }])
      .select()
      .single();

    if (error) {
      console.error('User creation error:', error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ user: data });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request) {
  const _demo = demoGuard(); if (_demo) return _demo;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .single();

      if (error) return Response.json({ user: null });
      return Response.json({ user: data });
    }

    // List all users
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) return Response.json({ users: [] });
    return Response.json({ users: data || [] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
