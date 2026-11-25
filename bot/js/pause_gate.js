// Quiet mode for reminders: while a pause is active nothing is sent and due items wait;
// once it has ended, the due items are only re-planned ("held") and listed in one summary.
const nowMs = Date.now();
const state = pauseState(rowsOf('Get pause'), nowMs);
if (state.active) return [];
const held = state.ended.length > 0;
return rowsOf('Due tasks').map((t) => ({ json: { ...t, held } }));
