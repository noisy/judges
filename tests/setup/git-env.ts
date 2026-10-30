// A git hook runs with GIT_DIR, GIT_INDEX_FILE and friends pointing at the repository being committed.
// Tests that create throwaway repositories would inherit them and write into that repository instead,
// so they are cleared before any test runs.
const REPOSITORY_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
];

for (const name of REPOSITORY_VARIABLES) {
  delete process.env[name];
}
