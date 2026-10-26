// Constantes partagées entre main, harness et renderers

const MAX_STEPS = 50;
const MAX_RETRIES_PER_STEP = 2;
const MAX_CONTEXT_CHARS = 12000;
const DEFAULT_TEMPERATURE = 0.1;
const MAX_BACKUPS = 50;
const SESSIONS_RETENTION = 100;

// Limites de consommation de contexte (surchargeables via config.*)
const MAX_RESULT_CHARS  = 6000;   // ~1500 tokens — tronque les résultats d'outils longs
const WINDOW_KEEP_PAIRS = 10;     // garde les N dernières paires assistant/user
const WINDOW_THRESHOLD  = 26;     // déclenche la fenêtre au-delà de N messages totaux

const IPC = {
  LLM_REQUEST:    'llm:request',
  LLM_REPLY:      'llm:reply',       // + ':' + replyChannel uuid
  LLM_READY:      'llm:ready',
  LLM_PROGRESS:   'llm:progress',
  LLM_STATUS:     'llm:status',
  LLM_CONFIG:     'llm:config',
  LLM_UNLOAD:        'llm:unload',
  LLM_CLEAR_CACHE:   'llm:clear-cache',
  LLM_CACHE_CLEARED: 'llm:cache-cleared',
  AGENT_RUN:      'agent:run',
  AGENT_EVENT:    'agent:event',
  CONFIG_GET:     'config:get',
  CONFIG_SET:     'config:set',
  ENGINE_TEST:    'engine:test',
  SESSIONS_LIST:   'sessions:list',
  SESSIONS_GET:    'sessions:get',
  SESSIONS_EXPORT: 'sessions:export',
  AGENT_CANCEL:   'agent:cancel',
  FOLDER_DIALOG:  'folder:dialog',
  FILE_DIALOG:    'file:dialog',
  WRITE_PENDING:  'write:pending',
  WRITE_DECISION: 'write:decision',
  PLAN_PENDING:       'plan:pending',
  PLAN_DECISION:      'plan:decision',
  ASK_USER_PENDING:   'ask_user:pending',
  ASK_USER_RESPONSE:  'ask_user:response',
  MODELS_LIST:        'models:list',
  WINDOW_FOCUS:       'window:focus',
  FILE_READ:          'file:read',
  SETTINGS_OPEN:      'settings:open',
  SETTINGS_CLOSE:     'settings:close',
  CONFIG_UPDATED:     'config:updated',
  SCHEDULE_LIST:      'schedule:list',
  SCHEDULE_ADD:       'schedule:add',
  SCHEDULE_DELETE:    'schedule:delete',
  SCHEDULE_TOGGLE:    'schedule:toggle',
  SCHEDULE_RUN:       'schedule:run',
  DESIGN_OPEN:        'design:open',
  DESIGN_CLOSE:       'design:close',
  DESIGN_READ_TOKENS: 'design:read-tokens',
  DESIGN_WRITE_FILE:  'design:write-file',
  VOICE_TRANSCRIBE:   'voice:transcribe',
  VOICE_REQUEST:      'voice:request',
  VOICE_REPLY:        'voice:reply',     // + ':' + replyChannel uuid
  VOICE_PROGRESS:     'voice:progress',
  VOICE_PRELOAD:      'voice:preload',
  DONATION_OPEN:      'donation:open',
  DONATION_SUCCESS:   'donation:success',
};

const ENGINES = {
  WEBLLM:        'webllm',
  GEMINI:        'gemini',
  CLAUDE:        'claude',
  OPENAI_COMPAT: 'openai-compat',
  DEEPSEEK:      'deepseek',
  CPU:           'cpu',
};

const TOOLS = {
  PLAN:         'plan',
  READ_FILE:    'read_file',
  WRITE_FILE:   'write_file',
  REPLACE_CODE: 'replace_code',
  LIST_DIR:     'list_dir',
  FINISH:       'finish',
  SEARCH_GREP:  'search_grep',
  GIT_STATUS:        'git_status',
  GIT_DIFF:          'git_diff',
  GIT_CREATE_BRANCH: 'git_create_branch',
  GIT_COMMIT:        'git_commit',
  FORMAT_FILE:          'format_file',
  FIND_RELEVANT_FILES:  'find_relevant_files',
  RUN_SHELL:    'run_shell',
  SPAWN_AGENT:          'spawn_agent',
  SPAWN_PARALLEL:       'spawn_parallel',
  ORCHESTRATE:          'orchestrate',
  ENABLE_COLLABORATION: 'enable_collaboration',
  POST_MESSAGE:         'post_message',
  READ_MESSAGES:        'read_messages',
  ASK_USER:             'ask_user',
  NOTE_USER:            'note_user',
  DELETE_FILE:          'delete_file',
  MOVE_FILE:            'move_file',
  FIND_SYMBOL:          'find_symbol',
  RUN_TESTS:            'run_tests',
  GET_PROJECT_INFO:     'get_project_info',
  RESTORE_FILE:         'restore_file',
  SCRATCHPAD_TOOL:      'scratchpad',
  DIFF_FILE:            'diff_file',
  BATCH_REPLACE:        'batch_replace',
  READ_URL:             'read_url',
  HTTP_REQUEST:         'http_request',
  CHECK_SERVICE:        'check_service',
  DEPLOY:               'deploy',
  START_PROCESS:        'start_process',
  STOP_PROCESS:         'stop_process',
  GET_OUTPUT:           'get_output',
  LIST_PROCESSES:       'list_processes',
  ADD_RULE:             'add_rule',
  DELETE_RULE:          'delete_rule',
  INSTALL_SKILL:        'install_skill',
  REMOVE_SKILL:         'remove_skill',
  CALL_API:             'call_api',
  BROWSER_OPEN:         'browser_open',
  BROWSER_NAVIGATE:     'browser_navigate',
  BROWSER_SCREENSHOT:   'browser_screenshot',
  BROWSER_CLICK:        'browser_click',
  BROWSER_TYPE:         'browser_type',
  BROWSER_EVALUATE:     'browser_evaluate',
  BROWSER_GET_TEXT:     'browser_get_text',
  BROWSER_GET_CONTENT:  'browser_get_content',
  BROWSER_GET_DOM:      'browser_get_dom',
  BROWSER_SCROLL:       'browser_scroll',
  BROWSER_SELECT:       'browser_select',
  BROWSER_CHECK:        'browser_check',
  BROWSER_KEY:          'browser_key',
  BROWSER_NEW_TAB:      'browser_new_tab',
  BROWSER_LIST_TABS:    'browser_list_tabs',
  BROWSER_SWITCH_TAB:   'browser_switch_tab',
  BROWSER_WAIT:         'browser_wait',
  BROWSER_CLOSE:        'browser_close',
  WEB_SEARCH:           'web_search',
  NOTIFY_USER:          'notify_user',
  GENERATE_VIDEO:       'generate_video',
  GENERATE_IMAGE:       'generate_image',
  MERGE_VIDEOS:         'merge_videos',
  GENERATE_SPEECH:      'generate_speech',
  LIST_SPEECH_VOICES:   'list_speech_voices',
  LSP_HOVER:            'lsp_hover',
  LSP_DEFINITION:       'lsp_definition',
  LSP_REFERENCES:       'lsp_references',
  FIX_LOOP:             'fix_loop',
  FIND_DEPENDENTS:      'find_dependents',
  FIND_DEPENDENCIES:    'find_dependencies',
  PROJECT_NOTE:         'project_note',
  GENERATE_PALETTE:     'generate_palette',
  READ_DESIGN_TOKENS:   'read_design_tokens',
};

const PROCS_IPC = {
  UPDATE:  'procs:update',
  START:   'procs:start',
  STOP:    'procs:stop',
  OUTPUT:  'procs:output',
  LIST:    'procs:list',
  KILL:    'procs:kill',
};

const APPS_IPC = {
  UPDATE:   'apps:update',
  REGISTER: 'apps:register',
  REMOVE:   'apps:remove',
  PING:     'apps:ping',
  SUSPEND:  'apps:suspend',
  RESUME:   'apps:resume',
};

const TDD_PHASES = {
  RED:      'red',
  GREEN:    'green',
  REFACTOR: 'refactor',
};

const PERSONA_IDS = {
  DEV:        'dev',
  ARCHITECTE: 'architecte',
  SECURITE:   'securite',
  REVIEWER:   'reviewer',
  CYBER:      'cyber',
  DESIGNER:   'designer',
};

module.exports = { MAX_STEPS, MAX_RETRIES_PER_STEP, MAX_CONTEXT_CHARS, DEFAULT_TEMPERATURE, MAX_BACKUPS, SESSIONS_RETENTION, MAX_RESULT_CHARS, WINDOW_KEEP_PAIRS, WINDOW_THRESHOLD, IPC, ENGINES, TOOLS, APPS_IPC, PROCS_IPC, TDD_PHASES, PERSONA_IDS };
