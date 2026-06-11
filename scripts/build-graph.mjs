#!/usr/bin/env node
// Tool dependency graph builder for googlesuper + github Composio toolkits.
// Node 22 ESM, stdlib only. Conforms to GRAPH_SPEC.md.
//
// Pipeline:
//  1. EXTRACT  flatten input params (top-level + nested required objects, dotted paths)
//              flatten output leaves under `data` (with [] for array hops)
//  2. TYPE     heuristic entity typing of params + producer outputs (namespaced types)
//  3. LLM      OpenRouter pass to classify params heuristics couldn't type / acquisition
//              (cached to data/llm-cache.json, batched, concurrency-capped)
//  4. EDGES    producer -> consumer per shared entity type, ubiquitous ctx types fanned
//              only from curated canonical resolvers
//  5. OUTPUT   data/graph.json + stats + hard acceptance checks

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
const p = (f) => ROOT + f;

// ----------------------------------------------------------------------------
// load .env (no deps)
// ----------------------------------------------------------------------------
function loadEnv() {
  try {
    for (const line of readFileSync(p(".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv();

const trim = (s, n = 200) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim().slice(0, n));
const firstSentence = (s) => {
  const t = trim(s, 600);
  const m = t.match(/^(.*?[.!?])(\s|$)/);
  return trim(m ? m[1] : t, 200);
};

// ----------------------------------------------------------------------------
// 1. EXTRACT
// ----------------------------------------------------------------------------
function flattenInput(schema) {
  // returns array of {name(dotted), type, required, description, examples}
  const out = [];
  if (!schema || schema.type !== "object" || !schema.properties) return out;
  const walk = (props, requiredSet, prefix) => {
    for (const [key, def] of Object.entries(props)) {
      const name = prefix ? `${prefix}.${key}` : key;
      const required = requiredSet.has(key);
      out.push({
        name,
        type: def.type || "string",
        required,
        description: trim(def.description, 200),
        examples: def.examples || [],
      });
      // descend into nested required objects (keep dotted path)
      if (def.type === "object" && def.properties && Object.keys(def.properties).length) {
        walk(def.properties, new Set(def.required || []), name);
      }
    }
  };
  walk(schema.properties, new Set(schema.required || []), "");
  return out;
}

function flattenOutputLeaves(schema) {
  // leaf json_paths under data.*  using [] for array hops
  const leaves = [];
  const data = schema?.properties?.data;
  if (!data) return leaves;
  const walk = (def, path) => {
    if (!def || typeof def !== "object") return;
    if (def.type === "array") {
      const items = def.items || {};
      if (items.properties) walk(items, path + "[]");
      else leaves.push(path + "[]");
      return;
    }
    if (def.type === "object" && def.properties && Object.keys(def.properties).length) {
      for (const [k, d] of Object.entries(def.properties)) walk(d, path ? `${path}.${k}` : k);
      return;
    }
    leaves.push(path);
  };
  walk(data, "data");
  return leaves;
}

// ----------------------------------------------------------------------------
// 2. ENTITY TYPING heuristics
// ----------------------------------------------------------------------------
// Map of entity type -> {name, description, acquisition}.
// acquisition: dependency (opaque id) | either (human-meaningful) | user
const ENTITY_DEFS = {
  // --- gmail / google ---
  "gmail.thread_id": ["Gmail Thread ID", "Opaque id of a Gmail thread", "dependency"],
  "gmail.message_id": ["Gmail Message ID", "Opaque id of a Gmail message", "dependency"],
  "gmail.draft_id": ["Gmail Draft ID", "Opaque id of a Gmail draft", "dependency"],
  "gmail.label_id": ["Gmail Label ID", "Id of a Gmail label", "dependency"],
  "gmail.history_id": ["Gmail History ID", "Gmail history id", "dependency"],
  email_address: ["Email Address", "A human email address", "either"],
  "calendar.calendar_id": ["Calendar ID", "Google Calendar id", "either"],
  "calendar.event_id": ["Calendar Event ID", "Google Calendar event id", "dependency"],
  "drive.file_id": ["Drive File ID", "Google Drive file id", "dependency"],
  "drive.folder_id": ["Drive Folder ID", "Google Drive folder id", "dependency"],
  "drive.permission_id": ["Drive Permission ID", "Drive permission id", "dependency"],
  "drive.drive_id": ["Shared Drive ID", "Google shared drive id", "dependency"],
  "docs.document_id": ["Docs Document ID", "Google Docs document id", "dependency"],
  "sheets.spreadsheet_id": ["Spreadsheet ID", "Google Sheets spreadsheet id", "dependency"],
  "slides.presentation_id": ["Presentation ID", "Google Slides presentation id", "dependency"],
  "photos.album_id": ["Photos Album ID", "Google Photos album id", "dependency"],
  "photos.media_item_id": ["Photos Media Item ID", "Google Photos media item id", "dependency"],
  "tasks.tasklist_id": ["Task List ID", "Google Tasks tasklist id", "dependency"],
  "tasks.task_id": ["Task ID", "Google Tasks task id", "dependency"],
  "contacts.resource_name": ["Contact Resource Name", "People API resource name (people/c123)", "dependency"],
  // --- github ---
  "github.owner": ["GitHub Owner", "Repository owner (user or org login)", "either"],
  "github.repo": ["GitHub Repo", "Repository name", "either"],
  "github.username": ["GitHub Username", "A GitHub user login", "either"],
  "github.org": ["GitHub Org", "A GitHub organization login", "either"],
  "github.issue_number": ["GitHub Issue Number", "Issue number within a repo", "dependency"],
  "github.pull_number": ["GitHub Pull Number", "Pull request number within a repo", "dependency"],
  "github.commit_sha": ["GitHub Commit SHA", "Git commit sha", "dependency"],
  "github.branch": ["GitHub Branch", "Branch name", "either"],
  "github.ref": ["GitHub Ref", "Git ref", "dependency"],
  "github.tag": ["GitHub Tag", "Git tag name", "either"],
  "github.release_id": ["GitHub Release ID", "Release id", "dependency"],
  "github.gist_id": ["GitHub Gist ID", "Gist id", "dependency"],
  "github.comment_id": ["GitHub Comment ID", "Comment id", "dependency"],
  "github.review_id": ["GitHub Review ID", "PR review id", "dependency"],
  "github.workflow_id": ["GitHub Workflow ID", "Actions workflow id", "dependency"],
  "github.run_id": ["GitHub Run ID", "Actions run id", "dependency"],
  "github.job_id": ["GitHub Job ID", "Actions job id", "dependency"],
  "github.artifact_id": ["GitHub Artifact ID", "Actions artifact id", "dependency"],
  "github.label_name": ["GitHub Label Name", "Issue label name", "either"],
  "github.milestone_number": ["GitHub Milestone Number", "Milestone number", "dependency"],
  "github.team_slug": ["GitHub Team Slug", "Team slug within an org", "either"],
  "github.project_id": ["GitHub Project ID", "Project id", "dependency"],
  "github.column_id": ["GitHub Column ID", "Project column id", "dependency"],
  "github.card_id": ["GitHub Card ID", "Project card id", "dependency"],
  "github.check_run_id": ["GitHub Check Run ID", "Check run id", "dependency"],
  "github.check_suite_id": ["GitHub Check Suite ID", "Check suite id", "dependency"],
  "github.deployment_id": ["GitHub Deployment ID", "Deployment id", "dependency"],
  "github.installation_id": ["GitHub Installation ID", "App installation id", "dependency"],
  "github.hook_id": ["GitHub Hook ID", "Webhook id", "dependency"],
  "github.discussion_number": ["GitHub Discussion Number", "Discussion number", "dependency"],
  "github.asset_id": ["GitHub Asset ID", "Release asset id", "dependency"],
  "github.runner_id": ["GitHub Runner ID", "Self-hosted runner id", "dependency"],
  "github.invitation_id": ["GitHub Invitation ID", "Invitation id", "dependency"],
  "github.alert_number": ["GitHub Alert Number", "Security alert number", "dependency"],
  "github.status_id": ["GitHub Status ID", "Commit status id", "dependency"],
};

// "either" / context types that are ubiquitous on github (~hundreds of tools).
// Only emit edges for these from a curated set of canonical resolver slugs.
const UBIQUITOUS = new Set(["github.owner", "github.repo", "github.username", "github.org", "github.branch", "github.tag", "github.label_name", "github.team_slug", "calendar.calendar_id", "email_address"]);

// Heuristic param classifier. Returns entity_type | null.
function classifyParam(param, tool) {
  const n = param.name.toLowerCase();
  const leaf = n.split(".").pop();
  const desc = (param.description || "").toLowerCase();
  const tk = tool.toolkit; // 'googlesuper' | 'github'
  const tn = tool.slug.toLowerCase();

  // generic free-text -> user (null)
  if (/(^|[._])(query|q|subject|body|message_body|title|name|description|text|content|comment_body|prompt|filter|keyword|search_query|note|reason)$/.test(leaf))
    if (!/_id$|_number$/.test(leaf)) return null;

  if (tk === "googlesuper") {
    if (leaf === "thread_id" || (leaf === "id" && /thread/.test(tn))) return "gmail.thread_id";
    if (leaf === "message_id" || (/gmail|email/.test(tn) && leaf === "id" && /message/.test(desc))) return "gmail.message_id";
    if (leaf === "draft_id") return "gmail.draft_id";
    if (leaf === "label_id" || (leaf === "id" && /label/.test(tn))) return "gmail.label_id";
    if (/^(add_label_ids|remove_label_ids|label_ids)$/.test(leaf)) return "gmail.label_id";
    if (/^(recipient_email|to|recipient|from_email|sender)$/.test(leaf) || (leaf.includes("email") && /address|recipient/.test(desc))) return "email_address";
    if (leaf === "cc" || leaf === "bcc") return "email_address";
    if (leaf === "calendar_id" || (leaf === "id" && /calendar/.test(tn))) return "calendar.calendar_id";
    if (leaf === "event_id" || (leaf === "id" && /event/.test(tn))) return "calendar.event_id";
    if (leaf === "file_id" || (leaf === "id" && /\bfile\b/.test(tn))) return "drive.file_id";
    if (leaf === "folder_id" || leaf === "parent_id") return "drive.folder_id";
    if (leaf === "permission_id") return "drive.permission_id";
    if (leaf === "drive_id") return "drive.drive_id";
    if (leaf === "document_id" || (leaf === "id" && /\bdoc/.test(tn))) return "docs.document_id";
    if (leaf === "spreadsheet_id" || (leaf === "id" && /(sheet|spreadsheet)/.test(tn))) return "sheets.spreadsheet_id";
    if (leaf === "presentation_id" || (leaf === "id" && /(slide|presentation)/.test(tn))) return "slides.presentation_id";
    if (leaf === "album_id") return "photos.album_id";
    if (leaf === "media_item_id" || (leaf === "id" && /media/.test(tn))) return "photos.media_item_id";
    if (leaf === "tasklist_id" || leaf === "tasklist") return "tasks.tasklist_id";
    if (leaf === "task_id" || (leaf === "id" && /task/.test(tn))) return "tasks.task_id";
    if (leaf === "resource_name" || /people\/c/.test(desc)) return "contacts.resource_name";
    return null;
  }

  // github
  if (leaf === "owner") return "github.owner";
  if (leaf === "repo" || leaf === "repository") return "github.repo";
  if (leaf === "username" || leaf === "login" || (leaf === "user" && /github/.test(tn))) return "github.username";
  if (leaf === "org" || leaf === "organization" || leaf === "org_id") return "github.org";
  if (leaf === "issue_number" || (leaf === "number" && /issue/.test(tn))) return "github.issue_number";
  if (leaf === "pull_number" || leaf === "pr_number" || (leaf === "number" && /pull|pr/.test(tn))) return "github.pull_number";
  if (/^(sha|commit_sha|commit_id|ref_sha|file_sha|blob_sha|tree_sha|base_tree)$/.test(leaf) || (leaf === "ref" && /commit|sha/.test(desc))) return "github.commit_sha";
  if (leaf === "branch" || leaf === "branch_name" || leaf === "base" || leaf === "head") return "github.branch";
  if (leaf === "ref") return "github.ref";
  if (leaf === "tag" || leaf === "tag_name") return "github.tag";
  if (leaf === "release_id") return "github.release_id";
  if (leaf === "gist_id") return "github.gist_id";
  if (leaf === "comment_id") return "github.comment_id";
  if (leaf === "review_id") return "github.review_id";
  if (leaf === "workflow_id") return "github.workflow_id";
  if (leaf === "run_id") return "github.run_id";
  if (leaf === "job_id") return "github.job_id";
  if (leaf === "artifact_id") return "github.artifact_id";
  if (leaf === "label" || leaf === "label_name" || leaf === "name" && /label/.test(tn)) return "github.label_name";
  if (leaf === "milestone_number" || (leaf === "milestone" && /number/.test(desc))) return "github.milestone_number";
  if (leaf === "team_slug" || leaf === "team_id") return "github.team_slug";
  if (leaf === "project_id") return "github.project_id";
  if (leaf === "column_id") return "github.column_id";
  if (leaf === "card_id") return "github.card_id";
  if (leaf === "check_run_id") return "github.check_run_id";
  if (leaf === "check_suite_id") return "github.check_suite_id";
  if (leaf === "deployment_id") return "github.deployment_id";
  if (leaf === "installation_id") return "github.installation_id";
  if (leaf === "hook_id") return "github.hook_id";
  if (leaf === "discussion_number") return "github.discussion_number";
  if (leaf === "asset_id") return "github.asset_id";
  if (leaf === "runner_id") return "github.runner_id";
  if (leaf === "invitation_id") return "github.invitation_id";
  if (leaf === "alert_number") return "github.alert_number";
  if (leaf === "status_id") return "github.status_id";
  if (leaf === "email" && /github/.test(tn)) return "email_address";
  return null;
}

// ----------------------------------------------------------------------------
// PRODUCERS: which tools produce which entity type + canonical source json_path.
// Output schemas in this dataset are mostly opaque (additionalProperties / empty
// item objects), so we INFER producer entity types from tool name/verb and
// synthesize a canonical source_path. Edge kind derived from the producing verb.
// ----------------------------------------------------------------------------

// canonical source path for an entity type when produced by a list/search/get tool
const SOURCE_PATH = {
  "gmail.thread_id": "data.threads[].id",
  "gmail.message_id": "data.messages[].id",
  "gmail.draft_id": "data.drafts[].id",
  "gmail.label_id": "data.labels[].id",
  email_address: "data.results[].emailAddresses[].value",
  "calendar.calendar_id": "data.items[].id",
  "calendar.event_id": "data.items[].id",
  "drive.file_id": "data.files[].id",
  "drive.folder_id": "data.files[].id",
  "drive.permission_id": "data.permissions[].id",
  "drive.drive_id": "data.drives[].id",
  "docs.document_id": "data.documentId",
  "sheets.spreadsheet_id": "data.spreadsheetId",
  "slides.presentation_id": "data.presentationId",
  "photos.album_id": "data.albums[].id",
  "photos.media_item_id": "data.mediaItems[].id",
  "tasks.tasklist_id": "data.items[].id",
  "tasks.task_id": "data.items[].id",
  "contacts.resource_name": "data.results[].person.resourceName",
  "github.owner": "data[].owner.login",
  "github.repo": "data[].name",
  "github.username": "data[].login",
  "github.org": "data[].login",
  "github.issue_number": "data[].number",
  "github.pull_number": "data[].number",
  "github.commit_sha": "data[].sha",
  "github.branch": "data[].name",
  "github.ref": "data[].ref",
  "github.tag": "data[].name",
  "github.release_id": "data[].id",
  "github.gist_id": "data[].id",
  "github.comment_id": "data[].id",
  "github.review_id": "data[].id",
  "github.workflow_id": "data.workflows[].id",
  "github.run_id": "data.workflow_runs[].id",
  "github.job_id": "data.jobs[].id",
  "github.artifact_id": "data.artifacts[].id",
  "github.label_name": "data[].name",
  "github.milestone_number": "data[].number",
  "github.team_slug": "data[].slug",
  "github.project_id": "data[].id",
  "github.column_id": "data[].id",
  "github.card_id": "data[].id",
  "github.check_run_id": "data.check_runs[].id",
  "github.check_suite_id": "data.check_suites[].id",
  "github.deployment_id": "data[].id",
  "github.installation_id": "data.installations[].id",
  "github.hook_id": "data[].id",
  "github.discussion_number": "data[].number",
  "github.asset_id": "data[].id",
  "github.runner_id": "data.runners[].id",
  "github.invitation_id": "data[].id",
  "github.alert_number": "data[].number",
  "github.status_id": "data[].id",
};

// Curated canonical resolvers for ubiquitous github context types (verified to exist below).
const CANONICAL_RESOLVERS = {
  "github.repo": ["GITHUB_SEARCH_REPOSITORIES", "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", "GITHUB_LIST_REPOSITORIES_FOR_A_USER", "GITHUB_LIST_ORGANIZATION_REPOSITORIES"],
  "github.owner": ["GITHUB_GET_THE_AUTHENTICATED_USER", "GITHUB_SEARCH_USERS", "GITHUB_LIST_ORGANIZATIONS_FOR_THE_AUTHENTICATED_USER", "GITHUB_SEARCH_REPOSITORIES"],
  "github.username": ["GITHUB_SEARCH_USERS", "GITHUB_GET_THE_AUTHENTICATED_USER", "GITHUB_LIST_REPOSITORY_COLLABORATORS"],
  "github.org": ["GITHUB_LIST_ORGANIZATIONS_FOR_THE_AUTHENTICATED_USER", "GITHUB_SEARCH_USERS"],
  "github.branch": ["GITHUB_LIST_BRANCHES"],
  "github.tag": ["GITHUB_LIST_REPOSITORY_TAGS"],
  "github.label_name": ["GITHUB_LIST_LABELS_FOR_A_REPOSITORY"],
  "github.team_slug": ["GITHUB_LIST_TEAMS"],
  email_address: ["GOOGLESUPER_SEARCH_PEOPLE", "GOOGLESUPER_GET_CONTACTS", "GOOGLESUPER_GET_PEOPLE"],
  "calendar.calendar_id": ["GOOGLESUPER_LIST_CALENDARS", "GOOGLESUPER_FIND_FREE_SLOTS"],
};

// Decide if a tool produces a given entity type, and with what kind.
// Returns null or {kind, confidence}.
function producesEntity(tool, et) {
  const tn = tool.slug;
  const low = tn.toLowerCase();
  const isList = /(_LIST_|^GITHUB_LIST|LIST$|_SEARCH_|SEARCH$|^GOOGLESUPER_LIST|FETCH|^GITHUB_GET_.*_LIST)/.test(tn) || /^GITHUB_LIST/.test(tn) || /_LIST$/.test(tn);
  const isSearch = /SEARCH/.test(tn);
  const isGet = /(^GITHUB_GET|^GOOGLESUPER_GET|GET_THE_AUTHENTICATED|^GITHUB_GET_A)/.test(tn) || /\bGET\b/.test(tn);
  const isCreate = /(CREATE|^GITHUB_CREATE|^GOOGLESUPER_CREATE|ADD_LABEL|CREATE_DRAFT)/.test(tn);

  // build a lexical "does this tool concern X resource" test from name
  const has = (re) => re.test(tn);

  // entity-specific producer rules
  const RULES = {
    "gmail.thread_id": () => has(/LIST_THREADS|FETCH_EMAILS|GET_THREAD|LIST_DRAFTS/),
    "gmail.message_id": () => has(/FETCH_EMAILS|LIST_MESSAGES|GET_MESSAGE|SEND_EMAIL|LIST_THREADS/),
    "gmail.draft_id": () => has(/LIST_DRAFTS|CREATE.*DRAFT|GET_DRAFT/),
    "gmail.label_id": () => has(/LIST_LABELS|GET_LABELS|CREATE_LABEL|ADD_LABEL/),
    email_address: () => has(/SEARCH_PEOPLE|GET_CONTACTS|GET_PEOPLE/),
    "calendar.calendar_id": () => has(/LIST_CALENDARS|FIND_FREE|GET_CALENDAR/),
    "calendar.event_id": () => has(/LIST_EVENTS|FIND_EVENT|GET_EVENT|CREATE_EVENT|QUICK_ADD|SYNC_EVENTS/),
    "drive.file_id": () => has(/FIND_FILE|LIST_FILES|SEARCH|GET_FILE|UPLOAD_FILE|CREATE_FILE|COPY_FILE/) && has(/FILE|DRIVE/),
    "drive.folder_id": () => has(/FOLDER|FIND_FILE|LIST_FILES/) ,
    "drive.permission_id": () => has(/PERMISSION/) && (isList || isCreate),
    "drive.drive_id": () => has(/LIST_DRIVES|SHARED_DRIVE/),
    "docs.document_id": () => has(/CREATE_DOC|GET_DOC|FIND.*DOC|DOCUMENT/) ,
    "sheets.spreadsheet_id": () => has(/CREATE.*SHEET|SPREADSHEET|GET_SHEET|FIND.*SHEET/),
    "slides.presentation_id": () => has(/PRESENTATION|CREATE.*SLIDE/),
    "photos.album_id": () => has(/ALBUM/) && (isList || isCreate || isGet),
    "photos.media_item_id": () => has(/MEDIA|PHOTO/) && (isList || isSearch),
    "tasks.tasklist_id": () => has(/TASKLIST|LIST_TASK_LISTS|TASK_LIST/),
    "tasks.task_id": () => has(/LIST_TASKS|GET_TASK|CREATE_TASK|INSERT_TASK/),
    "contacts.resource_name": () => has(/SEARCH_PEOPLE|GET_CONTACTS|GET_PEOPLE/),

    "github.issue_number": () => has(/ISSUE/) && (isList || isSearch || isCreate) && !has(/COMMENT|EVENT|LABEL|REACTION|ASSIGNEE|TIMELINE|MILESTONE/),
    "github.pull_number": () => has(/PULL/) && (isList || isSearch || isCreate) && !has(/COMMENT|REVIEW|FILE|COMMIT/),
    "github.commit_sha": () => has(/COMMIT/) && (isList || isGet || isSearch) ,
    "github.branch": () => has(/LIST_BRANCH/),
    "github.ref": () => has(/LIST_MATCHING_REF|REF/) && isList,
    "github.tag": () => has(/LIST.*TAG|TAGS/),
    "github.release_id": () => has(/RELEASE/) && (isList || isCreate || isGet) && !has(/ASSET|NOTE/),
    "github.gist_id": () => has(/GIST/) && (isList || isCreate),
    "github.comment_id": () => has(/COMMENT/) && (isList || isCreate),
    "github.review_id": () => has(/REVIEW/) && (isList || isCreate) && has(/PULL|PR/),
    "github.workflow_id": () => has(/WORKFLOW/) && isList && !has(/RUN|JOB/),
    "github.run_id": () => has(/WORKFLOW_RUN|LIST.*RUNS|RE_?RUN/) ,
    "github.job_id": () => has(/JOB/) && isList,
    "github.artifact_id": () => has(/ARTIFACT/) && isList,
    "github.label_name": () => has(/LABEL/) && isList,
    "github.milestone_number": () => has(/MILESTONE/) && (isList || isCreate),
    "github.team_slug": () => has(/TEAM/) && isList,
    "github.project_id": () => has(/PROJECT/) && (isList || isCreate) && !has(/COLUMN|CARD/),
    "github.column_id": () => has(/COLUMN/) && (isList || isCreate),
    "github.card_id": () => has(/CARD/) && (isList || isCreate),
    "github.check_run_id": () => has(/CHECK_RUN/) && (isList || isCreate),
    "github.check_suite_id": () => has(/CHECK_SUITE/) && (isList || isCreate),
    "github.deployment_id": () => has(/DEPLOYMENT/) && (isList || isCreate) && !has(/STATUS/),
    "github.status_id": () => has(/DEPLOYMENT_STATUS/) && (isList || isCreate),
    "github.installation_id": () => has(/INSTALLATION/) && isList,
    "github.hook_id": () => has(/HOOK|WEBHOOK/) && (isList || isCreate),
    "github.discussion_number": () => has(/DISCUSSION/) && (isList || isCreate),
    "github.asset_id": () => has(/RELEASE_ASSET|ASSET/) && isList,
    "github.runner_id": () => has(/RUNNER/) && isList,
    "github.invitation_id": () => has(/INVITATION/) && isList,
    "github.alert_number": () => has(/ALERT/) && isList,
    "github.repo": () => false, // handled via canonical resolvers
    "github.owner": () => false,
    "github.username": () => false,
    "github.org": () => false,
  };

  const r = RULES[et];
  if (!r) return null;
  if (!r()) return null;
  let kind = "id_lookup";
  if (isCreate && !(isList || isSearch)) kind = "creator";
  if (et === "email_address" || et === "contacts.resource_name") kind = "resolver";
  let confidence = isList || isSearch ? 0.95 : isGet ? 0.85 : isCreate ? 0.9 : 0.8;
  if (kind === "creator") confidence = 0.9;
  return { kind, confidence };
}

// ----------------------------------------------------------------------------
// LLM PASS (OpenRouter) for params heuristics couldn't type confidently.
// ----------------------------------------------------------------------------
const CACHE_PATH = p("data/llm-cache.json");
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")); } catch {}

const MODELS = ["anthropic/claude-sonnet-4.6", "openai/gpt-5-mini", "google/gemini-2.5-flash"];
let activeModel = null;
let llmDead = false;

async function callModel(messages) {
  const tryModels = activeModel ? [activeModel] : MODELS;
  for (const model of tryModels.length ? tryModels : MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 4000, response_format: { type: "json_object" } }),
      });
      if (res.status >= 400 && res.status < 500) {
        // model/auth issue: try next model
        if (res.status === 401 || res.status === 403) { llmDead = true; return null; }
        continue;
      }
      const j = await res.json();
      const content = j.choices?.[0]?.message?.content;
      if (!content) continue;
      activeModel = model;
      return content;
    } catch (e) {
      // network/transient: try next
      continue;
    }
  }
  return null;
}

function hashBatch(items) {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 16);
}

async function llmClassify(batches) {
  // batches: array of arrays of {key, tool, param, type, desc, examples}
  // returns map key -> {entity_type|null, acquisition}
  const result = {};
  const allowed = Object.keys(ENTITY_DEFS);
  const sys = `You classify Composio tool input parameters for a dependency graph.
For each param decide:
- entity_type: one of [${allowed.join(", ")}] or null if it is free-text the user supplies directly (subject, body, query, title, message, generic text).
- acquisition: "user" (user supplies it, e.g. subject/body/query), "dependency" (opaque internal id that MUST come from another tool's output), or "either" (human-meaningful value the user may give OR a tool can resolve: email address, repo name, username, branch, tag, label).
Return STRICT JSON: {"items":[{"key":"<key>","entity_type":<string|null>,"acquisition":"<user|dependency|either>"}]}. No prose.`;

  const pending = [];
  for (const batch of batches) {
    const h = hashBatch(batch.map((b) => [b.tool, b.param, b.type, b.desc]));
    if (cache[h]) { Object.assign(result, cache[h]); continue; }
    pending.push({ h, batch });
  }

  // concurrency cap 8
  const queue = [...pending];
  async function worker() {
    while (queue.length) {
      const { h, batch } = queue.shift();
      const user = JSON.stringify({ params: batch.map((b) => ({ key: b.key, tool: b.tool, param: b.param, type: b.type, description: b.desc, examples: b.examples })) });
      const content = await callModel([{ role: "system", content: sys }, { role: "user", content: user }]);
      const map = {};
      if (content) {
        try {
          const parsed = JSON.parse(content);
          for (const it of parsed.items || []) {
            if (!it || !it.key) continue;
            let et = it.entity_type;
            if (et && !ENTITY_DEFS[et]) et = null;
            const acq = ["user", "dependency", "either"].includes(it.acquisition) ? it.acquisition : "user";
            map[it.key] = { entity_type: et ?? null, acquisition: acq };
          }
        } catch {}
      }
      cache[h] = map;
      Object.assign(result, map);
      if (llmDead) { queue.length = 0; break; }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  try { writeFileSync(CACHE_PATH, JSON.stringify(cache)); } catch {}
  return result;
}

// ----------------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------------
async function main() {
  const gsuper = JSON.parse(readFileSync(p("data/googlesuper_tools.json"), "utf8"));
  const github = JSON.parse(readFileSync(p("data/github_tools.json"), "utf8"));
  const tools = [...gsuper, ...github].map((t) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    toolkit: typeof t.toolkit === "string" ? t.toolkit : t.toolkit?.slug,
    input_parameters: t.input_parameters,
    output_parameters: t.output_parameters,
  }));

  // 1+2. extract + heuristic type
  const nodes = [];
  const usedEntities = new Set();
  const ambiguous = []; // params needing LLM

  for (const tool of tools) {
    const flatIn = flattenInput(tool.input_parameters);
    const params = [];
    for (const fp of flatIn) {
      const et = classifyParam(fp, tool);
      let acquisition;
      if (et) {
        acquisition = ENTITY_DEFS[et][2]; // dependency/either/user from def
        usedEntities.add(et);
      } else {
        // generic; tentatively user, but if required + looks id-ish, send to LLM
        acquisition = "user";
        const leaf = fp.name.split(".").pop().toLowerCase();
        if (fp.required && /(_id$|_number$|_key$|_slug$|_sha$|^id$|ref$)/.test(leaf)) {
          ambiguous.push({ key: `${tool.slug}::${fp.name}`, tool: tool.slug, param: fp.name, type: fp.type, desc: fp.description, examples: fp.examples?.slice(0, 2) || [] });
        }
      }
      params.push({
        name: fp.name,
        required: fp.required,
        type: fp.type,
        entity_type: et,
        acquisition,
        description: fp.description,
        _examples: fp.examples,
      });
    }
    nodes.push({
      id: tool.slug,
      toolkit: tool.toolkit,
      name: tool.name,
      description: firstSentence(tool.description),
      params,
      produces: [], // filled below
    });
  }

  // 3. LLM pass for ambiguous required id-ish params
  let generatedBy = "heuristics";
  if (ambiguous.length && process.env.OPENROUTER_API_KEY) {
    const BATCH = 60;
    const batches = [];
    for (let i = 0; i < ambiguous.length; i += BATCH) batches.push(ambiguous.slice(i, i + BATCH));
    const llmMap = await llmClassify(batches);
    let applied = 0;
    if (!llmDead && Object.keys(llmMap).length) {
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      for (const [key, v] of Object.entries(llmMap)) {
        const [slug, pname] = key.split("::");
        const node = nodeById.get(slug);
        if (!node) continue;
        const param = node.params.find((p2) => p2.name === pname);
        if (!param || param.entity_type) continue;
        if (v.entity_type) { param.entity_type = v.entity_type; usedEntities.add(v.entity_type); applied++; }
        param.acquisition = param.entity_type ? ENTITY_DEFS[param.entity_type][2] : v.acquisition || param.acquisition;
      }
      generatedBy = `heuristics + LLM (${activeModel}, ${applied}/${ambiguous.length} ambiguous params typed)`;
    } else if (llmDead) {
      generatedBy = "heuristics-only (OpenRouter key dead / unauthorized)";
    } else {
      generatedBy = "heuristics-only (LLM returned no usable results)";
    }
  } else {
    generatedBy = "heuristics-only (no ambiguous params or no API key)";
  }

  // strip temp _examples
  for (const n of nodes) for (const pr of n.params) delete pr._examples;

  // build producer index: entity_type -> [{slug, kind, confidence, source_path}]
  const producers = {}; // et -> array
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const tool of tools) {
    for (const et of Object.keys(ENTITY_DEFS)) {
      const r = producesEntity(tool, et);
      if (!r) continue;
      const sp = SOURCE_PATH[et] || "data";
      (producers[et] ||= []).push({ slug: tool.slug, kind: r.kind, confidence: r.confidence, source_path: sp });
      // record produces on node
      const node = nodeById.get(tool.slug);
      if (!node.produces.find((x) => x.entity_type === et)) node.produces.push({ entity_type: et, json_path: sp });
      usedEntities.add(et);
    }
  }
  // ensure curated canonical resolvers are registered as producers even if rule missed them
  for (const [et, slugs] of Object.entries(CANONICAL_RESOLVERS)) {
    for (const slug of slugs) {
      if (!nodeById.has(slug)) continue; // never invent slugs
      const sp = SOURCE_PATH[et] || "data";
      (producers[et] ||= []);
      if (!producers[et].find((x) => x.slug === slug)) {
        const kind = et === "email_address" || et === "calendar.calendar_id" ? "resolver" : "id_lookup";
        producers[et].push({ slug, kind, confidence: 0.8, source_path: sp });
        const node = nodeById.get(slug);
        if (!node.produces.find((x) => x.entity_type === et)) node.produces.push({ entity_type: et, json_path: sp });
      }
      usedEntities.add(et);
    }
  }

  // 4. EDGES
  const edges = [];
  const seenEdge = new Set();
  const requiredDepParams = []; // for coverage stats: {tool, param, et}
  for (const node of nodes) {
    for (const param of node.params) {
      const et = param.entity_type;
      if (!et) continue;
      if (param.acquisition === "user") continue; // user-only, no edge
      if (!param.required && param.acquisition !== "either") {
        // optional dependency: still allow edges but don't count in coverage
      }
      const isDepLike = param.acquisition === "dependency" || param.acquisition === "either";
      if (!isDepLike) continue;
      if (param.required && param.acquisition === "dependency") requiredDepParams.push({ tool: node.id, param: param.name, et });

      let prodList = producers[et] || [];
      // ubiquitous context: restrict to curated canonical resolvers
      if (UBIQUITOUS.has(et)) {
        const allow = new Set(CANONICAL_RESOLVERS[et] || []);
        prodList = prodList.filter((pr) => allow.has(pr.slug));
      }
      for (const pr of prodList) {
        if (pr.slug === node.id) continue; // no self edge
        const ekey = `${pr.slug}>${node.id}:${et}:${param.name}`;
        if (seenEdge.has(ekey)) continue;
        seenEdge.add(ekey);
        edges.push({
          from: pr.slug,
          to: node.id,
          entity_type: et,
          param: param.name,
          source_path: pr.source_path,
          kind: pr.kind,
          confidence: pr.kind === "resolver" ? 0.8 : pr.confidence,
        });
      }
    }
  }

  // entity_types array (only used ones)
  const entity_types = [...usedEntities].sort().map((id) => ({
    id,
    name: ENTITY_DEFS[id]?.[0] || id,
    description: ENTITY_DEFS[id]?.[1] || "",
    acquisition: ENTITY_DEFS[id]?.[2] || "dependency",
  }));

  const graph = {
    meta: {
      toolkits: ["googlesuper", "github"],
      tool_count: nodes.length,
      edge_count: edges.length,
      generated_by: generatedBy,
    },
    entity_types,
    nodes,
    edges,
  };

  writeFileSync(p("data/graph.json"), JSON.stringify(graph));

  // ---- STATS ----
  const sizeMB = (JSON.stringify(graph).length / 1e6).toFixed(2);
  console.log("\n=== GRAPH STATS ===");
  console.log(`nodes: ${nodes.length}  edges: ${edges.length}  entity_types: ${entity_types.length}  size: ${sizeMB}MB`);
  console.log(`generated_by: ${generatedBy}`);

  const byEt = {};
  for (const e of edges) byEt[e.entity_type] = (byEt[e.entity_type] || 0) + 1;
  console.log("\nedges per entity type (top 20):");
  for (const [et, c] of Object.entries(byEt).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${et.padEnd(28)} ${c}`);

  // resolution coverage: required dependency params with >=1 producer
  const covered = requiredDepParams.filter((r) => edges.some((e) => e.to === r.tool && e.param === r.param));
  const cov = requiredDepParams.length ? ((covered.length / requiredDepParams.length) * 100).toFixed(1) : "100.0";
  console.log(`\nresolution coverage (required dependency params with >=1 producer): ${cov}%  (${covered.length}/${requiredDepParams.length})`);

  const zero = requiredDepParams.filter((r) => !edges.some((e) => e.to === r.tool && e.param === r.param));
  const zeroByEt = {};
  for (const z of zero) zeroByEt[z.et] = (zeroByEt[z.et] || 0) + 1;
  console.log(`\nrequired dependency params with ZERO producers: ${zero.length}`);
  for (const [et, c] of Object.entries(zeroByEt).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${et.padEnd(28)} ${c}`);

  // ---- HARD ACCEPTANCE CHECKS ----
  console.log("\n=== ACCEPTANCE CHECKS ===");
  const checks = [];
  const edgeExists = (to, paramRe, fromSlug, kind) =>
    edges.some((e) => e.to === to && paramRe.test(e.param) && (!fromSlug || e.from === fromSlug) && (!kind || e.kind === kind));

  // 1. REPLY_TO_THREAD.thread_id producers include LIST_THREADS
  const c1 = edgeExists("GOOGLESUPER_REPLY_TO_THREAD", /^thread_id$/, "GOOGLESUPER_LIST_THREADS");
  checks.push(["GOOGLESUPER_REPLY_TO_THREAD.thread_id <- GOOGLESUPER_LIST_THREADS", c1]);

  // 2. send-email recipient is "either" + has resolver edge from contacts/people
  const sendNode = nodeById.get("GOOGLESUPER_SEND_EMAIL");
  const recip = sendNode?.params.find((x) => /recipient_email|recipient|to/.test(x.name));
  const c2a = recip?.acquisition === "either";
  const c2b = edges.some((e) => e.to === "GOOGLESUPER_SEND_EMAIL" && e.kind === "resolver" && /PEOPLE|CONTACT/.test(e.from));
  checks.push(["GOOGLESUPER_SEND_EMAIL recipient acquisition=either", c2a]);
  checks.push(["GOOGLESUPER_SEND_EMAIL has resolver edge from contacts/people", c2b]);

  // 3. github issue_number consumers have producers incl list/search issues
  const issueConsumer = nodes.find((n) => n.toolkit === "github" && n.params.some((x) => x.entity_type === "github.issue_number" && x.required));
  const c3 = issueConsumer && edges.some((e) => e.to === issueConsumer.id && e.entity_type === "github.issue_number" && /LIST|SEARCH/.test(e.from));
  checks.push([`github issue_number consumer (${issueConsumer?.id}) <- list/search issues`, !!c3]);

  const prConsumer = nodes.find((n) => n.toolkit === "github" && n.params.some((x) => x.entity_type === "github.pull_number" && x.required));
  const c4 = prConsumer && edges.some((e) => e.to === prConsumer.id && e.entity_type === "github.pull_number" && /LIST|SEARCH|PULLS/.test(e.from));
  checks.push([`github pull_number consumer (${prConsumer?.id}) <- list/search PRs`, !!c4]);

  let allPass = true;
  for (const [label, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) allPass = false; }
  console.log(`\nOVERALL: ${allPass ? "PASS" : "FAIL"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
