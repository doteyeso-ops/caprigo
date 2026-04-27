/**
 * MiroFish Integration (Optional)
 *
 * API-driven integration with MiroFish swarm intelligence engine.
 * https://github.com/666ghj/MiroFish
 *
 * To enable: copy this folder to skills/mirofish
 * Requires: MiroFish backend on port 5001. Set MIROFISH_URL to override.
 */

const BASE_URL = process.env.MIROFISH_URL || 'http://localhost:5001';

async function mirofishFetch(path, options = {}) {
  const url = `${BASE_URL.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { success: false, error: `Invalid JSON: ${text.slice(0, 200)}` };
  }
  return { success: res.ok, status: res.status, data };
}

module.exports = [
  {
    name: 'mirofish_status',
    description: 'Check if MiroFish swarm prediction engine is running.',
    execute: async () => {
      try {
        const result = await mirofishFetch('/health');
        if (result.success) {
          return { success: true, ...result.data, message: 'MiroFish is running' };
        }
        return { success: false, error: 'MiroFish not responding', ...result };
      } catch (err) {
        return { success: false, error: err.message, hint: 'MiroFish backend runs on port 5001' };
      }
    },
  },
  {
    name: 'mirofish_list_projects',
    description: 'List MiroFish projects (seed data for predictions).',
    execute: async () => {
      try {
        const result = await mirofishFetch('/api/graph/project/list');
        if (!result.success) return { success: false, error: result.data?.error || 'Failed' };
        const projects = result.data?.data || [];
        return { success: true, count: projects.length, projects: projects.map((p) => ({ id: p.project_id, name: p.name, status: p.status })) };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },
  {
    name: 'mirofish_list_simulations',
    description: 'List MiroFish simulation runs.',
    execute: async () => {
      try {
        const result = await mirofishFetch('/api/simulation/list');
        if (!result.success) return { success: false, error: result.data?.error || 'Failed' };
        const sims = result.data?.data || [];
        return { success: true, count: sims.length, simulations: sims.map((s) => ({ id: s.simulation_id, project_id: s.project_id, status: s.status })) };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },
];
