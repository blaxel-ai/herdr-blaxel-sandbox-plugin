import { PluginError } from "./result.mjs";
import { updateState } from "./state.mjs";

export function nowIso() {
  return new Date().toISOString();
}

export async function patchMapping(mappingId, patch) {
  let updated;
  await updateState((state) => {
    const mapping = state.mappings[mappingId];
    if (!mapping) {
      throw new PluginError(
        "mapping_not_found",
        `Mapping ${mappingId} no longer exists.`,
      );
    }
    updated = { ...mapping, ...patch, updatedAt: nowIso() };
    state.mappings[mappingId] = updated;
    return state;
  });
  return updated;
}
