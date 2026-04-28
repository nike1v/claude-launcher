// Thin re-export layer kept so existing imports under
// `../lib/environment-dedup` keep working. Logic lives in
// `src/shared/host-utils.ts` so the main process and the renderer agree on
// what "same environment" means (the migration in environment-store and
// the Add-Environment UI used to disagree on port equality).
export {
  isSameHostTarget as isSameEnvironmentTarget,
  findDuplicateEnvironment
} from '../../../shared/host-utils'
