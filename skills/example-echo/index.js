/**
 * Example user skill - Echo
 * Drop skills in ~/.caprigo/skills/ or ./skills/ to extend your agent.
 *
 * Format: export a Skill or Skill[] with { name, description, execute }
 */

module.exports = {
  name: 'echo',
  description: 'Echo back the input message (example user skill)',
  execute: async (params) => {
    const msg = params?.message ?? params?.text ?? 'nothing';
    return { success: true, echoed: msg };
  },
};
