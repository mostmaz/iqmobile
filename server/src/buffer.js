// Buffer GraphQL API client for one-click "Publish to FB + IG" from the
// admin dashboard.
//
// Buffer (buffer.com) fronts the Meta APIs: you connect the Facebook Page
// and Instagram Business account inside Buffer once, then post to them with
// a single personal API key — no Meta app review on our side. We post to
// each connected channel with its own createPost call.
//
// Config (env — all secret-ish, live in the droplet's .env, never git):
//   BUFFER_API_KEY          personal API key (Settings → API → App Clients)
//   BUFFER_FB_CHANNEL_ID    the connected Facebook Page channel id
//   BUFFER_IG_CHANNEL_ID    the connected Instagram channel id
//
// Node 18+ global fetch is used (droplet runs Node 22).

const ENDPOINT = 'https://api.buffer.com';

// Text / channelId / imageUrl are passed as variables so Arabic captions,
// newlines, and quotes can't break the query string. channelId is Buffer's
// custom ChannelId scalar (NOT String — the API rejects String). The
// per-platform post `type` is required and lives under metadata, and it
// differs by service, so we build the metadata block inline per channel:
//   facebook  → metadata:{ facebook:{ type:post } }
//   instagram → metadata:{ instagram:{ type:post shouldShareToFeed:true } }
// (shouldShareToFeed is a required boolean on Instagram.) schedulingType
// automatic + mode addToQueue drops the post into the account's Buffer queue
// to publish at its next scheduled slot.
function metadataFor(service) {
  if (service === 'instagram') return 'metadata:{ instagram:{ type:post shouldShareToFeed:true } }';
  return 'metadata:{ facebook:{ type:post } }';
}
// mode customScheduled + dueAt publishes at an exact time we pick (the next
// 10am/3pm/6pm slot, computed by the caller) rather than relying on a Buffer
// posting schedule — Buffer's API has no mutation to set that schedule, and
// this keeps the timing entirely in our control.
function createPostMutation(service) {
  return `mutation($text:String!,$channelId:ChannelId!,$imageUrl:String!,$dueAt:DateTime!){
    createPost(input:{
      text:$text
      channelId:$channelId
      schedulingType:automatic
      mode:customScheduled
      dueAt:$dueAt
      assets:[{ image:{ url:$imageUrl } }]
      ${metadataFor(service)}
    }){
      ... on PostActionSuccess { post { id } }
      ... on MutationError { message }
    }
  }`;
}

const API_KEY = () => process.env.BUFFER_API_KEY || '';
export function bufferChannels() {
  return {
    fb: process.env.BUFFER_FB_CHANNEL_ID || null,
    ig: process.env.BUFFER_IG_CHANNEL_ID || null,
  };
}
export function bufferConfigured() {
  const { fb, ig } = bufferChannels();
  return !!API_KEY() && (!!fb || !!ig);
}

// Post to a single Buffer channel, scheduled at dueAt (ISO 8601 string).
// Returns { ok, postId } or { ok:false, error }.
async function createPost(channelId, service, text, imageUrl, dueAt) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY()}`,
      },
      body: JSON.stringify({ query: createPostMutation(service), variables: { text, channelId, imageUrl, dueAt } }),
    });
    const json = await res.json().catch(() => null);
    // Transport / auth errors surface as HTTP != 200 or a top-level errors[].
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    if (json?.errors?.length) return { ok: false, error: json.errors[0]?.message || 'graphql_error' };
    const cp = json?.data?.createPost;
    if (cp?.post?.id) return { ok: true, postId: cp.post.id };
    // MutationError branch
    if (cp?.message) return { ok: false, error: cp.message };
    return { ok: false, error: 'unknown_response' };
  } catch (e) {
    return { ok: false, error: e?.message || 'network' };
  }
}

// Publish the same caption + image to every configured channel, scheduled at
// `dueAt` (ISO 8601). `imageUrl` MUST be a publicly reachable https URL —
// Buffer fetches the image itself.
// Returns { any, results: [{ channel, channelId, ok, postId?, error? }] }.
export async function publishToChannels(text, imageUrl, dueAt) {
  const { fb, ig } = bufferChannels();
  const targets = [];
  if (fb) targets.push({ channel: 'facebook', channelId: fb });
  if (ig) targets.push({ channel: 'instagram', channelId: ig });

  const results = [];
  for (const t of targets) {
    const r = await createPost(t.channelId, t.channel, text, imageUrl, dueAt);
    results.push({ channel: t.channel, channelId: t.channelId, ...r });
  }
  return { any: results.some((r) => r.ok), results };
}
