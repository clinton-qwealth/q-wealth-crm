/**
 * The emoji the composer offers when someone types `:`.
 *
 * A curated list, not a dependency. TipTap's own Emoji extension is MIT and
 * would do this, but it inserts an `emoji` NODE — which the database would
 * refuse, and which would need adding to the whitelist, the plain-text
 * function, the client helpers and the renderer — and it ships the whole of
 * emojibase. This inserts a plain character into an ordinary text node: the
 * document the database validates does not change shape at all, and the
 * keyboard's own emoji picker has always produced exactly the same thing.
 *
 * Names are the common shortcodes, so `:thumbs` and `:+1` both find 👍, and
 * keywords catch the words people actually type — `:yes`, `:done`, `:call`.
 * A plain module with no directive; it is data and one pure function.
 */
export type Emoji = { glyph: string; name: string; keywords: readonly string[] }

const E = (glyph: string, name: string, ...keywords: string[]): Emoji => ({ glyph, name, keywords })

export const EMOJI: readonly Emoji[] = [
  // Reactions and acknowledgement
  E('👍', 'thumbs_up', '+1', 'yes', 'like', 'approve', 'agree', 'ok'),
  E('👎', 'thumbs_down', '-1', 'no', 'disagree'),
  E('👏', 'clap', 'applause', 'well done', 'bravo'),
  E('🙏', 'pray', 'thanks', 'thank you', 'please'),
  E('🙌', 'raised_hands', 'hooray', 'celebrate'),
  E('👌', 'ok_hand', 'okay', 'perfect'),
  E('🤝', 'handshake', 'deal', 'agreement'),
  E('✅', 'white_check_mark', 'check', 'done', 'tick', 'complete', 'yes'),
  E('☑️', 'ballot_box_with_check', 'checked', 'tick'),
  E('✔️', 'heavy_check_mark', 'tick', 'check'),
  E('❌', 'x', 'cross', 'no', 'wrong', 'cancel'),
  E('⭕', 'o', 'circle'),
  E('❗', 'exclamation', 'important', 'alert'),
  E('❓', 'question', 'ask', 'unknown'),
  E('⚠️', 'warning', 'caution', 'careful'),
  E('🚫', 'no_entry_sign', 'forbidden', 'blocked'),
  E('⛔', 'no_entry', 'stop', 'blocked'),
  E('💯', '100', 'hundred', 'perfect'),
  E('🔥', 'fire', 'hot', 'lit'),
  E('⭐', 'star', 'favourite'),
  E('🌟', 'star2', 'sparkle', 'glowing'),
  E('✨', 'sparkles', 'new', 'shiny', 'clean'),
  E('🎉', 'tada', 'party', 'celebrate', 'congratulations'),
  E('🎊', 'confetti_ball', 'party', 'celebrate'),
  E('🏆', 'trophy', 'win', 'award', 'champion'),
  E('🥇', 'first_place', 'gold', 'medal', 'winner'),
  E('🎯', 'dart', 'target', 'goal', 'bullseye'),
  E('🚀', 'rocket', 'launch', 'ship', 'fast'),
  E('💡', 'bulb', 'idea', 'light'),
  E('🔔', 'bell', 'reminder', 'notification'),
  E('📌', 'pushpin', 'pin', 'note'),
  E('📍', 'round_pushpin', 'location', 'here'),

  // Faces
  E('😀', 'grinning', 'smile', 'happy'),
  E('😃', 'smiley', 'happy', 'joy'),
  E('😄', 'smile', 'happy', 'laugh'),
  E('😁', 'grin', 'beam'),
  E('😆', 'laughing', 'haha', 'lol'),
  E('😂', 'joy', 'laugh', 'tears', 'lol'),
  E('🤣', 'rofl', 'laugh', 'rolling'),
  E('🙂', 'slightly_smiling_face', 'smile'),
  E('😊', 'blush', 'happy', 'shy'),
  E('😉', 'wink', 'joke'),
  E('😍', 'heart_eyes', 'love'),
  E('🤩', 'star_struck', 'wow', 'amazing'),
  E('😎', 'sunglasses', 'cool'),
  E('🤔', 'thinking', 'hmm', 'consider', 'wonder'),
  E('🤨', 'raised_eyebrow', 'suspicious', 'hmm'),
  E('😐', 'neutral_face', 'meh'),
  E('😑', 'expressionless', 'blank'),
  E('🙄', 'roll_eyes', 'eye roll', 'whatever'),
  E('😬', 'grimacing', 'awkward', 'eek'),
  E('😅', 'sweat_smile', 'phew', 'nervous'),
  E('😴', 'sleeping', 'tired', 'zzz'),
  E('😷', 'mask', 'sick', 'ill'),
  E('🤒', 'face_with_thermometer', 'sick', 'fever', 'unwell'),
  E('😕', 'confused', 'unsure'),
  E('😟', 'worried', 'concerned'),
  E('😢', 'cry', 'sad', 'tear'),
  E('😭', 'sob', 'crying', 'sad'),
  E('😤', 'triumph', 'frustrated', 'huff'),
  E('😡', 'rage', 'angry', 'mad'),
  E('🤯', 'exploding_head', 'mind blown', 'wow'),
  E('😱', 'scream', 'shocked', 'omg'),
  E('😮', 'open_mouth', 'surprised', 'wow'),
  E('🥳', 'partying_face', 'party', 'celebrate', 'birthday'),
  E('🤗', 'hugs', 'hug', 'welcome'),
  E('🤫', 'shushing_face', 'quiet', 'secret'),
  E('🤞', 'crossed_fingers', 'luck', 'hope'),
  E('💪', 'muscle', 'strong', 'flex', 'effort'),
  E('👀', 'eyes', 'look', 'looking', 'watching', 'see'),
  E('👋', 'wave', 'hello', 'hi', 'bye'),
  E('🧠', 'brain', 'smart', 'think'),

  // Hearts
  E('❤️', 'heart', 'love', 'red heart'),
  E('💙', 'blue_heart', 'love'),
  E('💚', 'green_heart', 'love'),
  E('💛', 'yellow_heart', 'love'),
  E('🧡', 'orange_heart', 'love'),
  E('💜', 'purple_heart', 'love'),
  E('💔', 'broken_heart', 'sad', 'heartbreak'),

  // Work
  E('📞', 'telephone_receiver', 'phone', 'call', 'ring'),
  E('📱', 'iphone', 'mobile', 'phone'),
  E('✉️', 'email', 'envelope', 'mail', 'letter'),
  E('📧', 'e-mail', 'email', 'mail'),
  E('📨', 'incoming_envelope', 'email', 'received'),
  E('📤', 'outbox_tray', 'sent', 'outbox'),
  E('📥', 'inbox_tray', 'inbox', 'received'),
  E('📅', 'date', 'calendar', 'schedule', 'appointment'),
  E('📆', 'calendar', 'date', 'schedule'),
  E('🗓️', 'spiral_calendar', 'calendar', 'schedule'),
  E('⏰', 'alarm_clock', 'reminder', 'time', 'deadline'),
  E('⏳', 'hourglass_flowing_sand', 'waiting', 'pending', 'time'),
  E('⌛', 'hourglass', 'waiting', 'time up'),
  E('🕐', 'clock1', 'time', 'clock'),
  E('📝', 'memo', 'note', 'notes', 'write', 'pencil'),
  E('📄', 'page_facing_up', 'document', 'page', 'file'),
  E('📃', 'page_with_curl', 'document', 'page'),
  E('📑', 'bookmark_tabs', 'tabs', 'document'),
  E('📋', 'clipboard', 'list', 'checklist', 'tasks'),
  E('📁', 'file_folder', 'folder', 'file'),
  E('📂', 'open_file_folder', 'folder', 'open'),
  E('🗂️', 'card_index_dividers', 'files', 'dividers'),
  E('📎', 'paperclip', 'attach', 'attachment'),
  E('🔗', 'link', 'url', 'chain'),
  E('✏️', 'pencil2', 'edit', 'write'),
  E('🖊️', 'pen', 'sign', 'write'),
  E('✒️', 'black_nib', 'sign', 'signature', 'pen'),
  E('🔍', 'mag', 'search', 'find', 'look'),
  E('🔎', 'mag_right', 'search', 'find'),
  E('🔒', 'lock', 'locked', 'secure', 'private'),
  E('🔓', 'unlock', 'unlocked', 'open'),
  E('🔑', 'key', 'password', 'access'),
  E('🛡️', 'shield', 'protect', 'security', 'insurance'),
  E('💼', 'briefcase', 'work', 'business'),
  E('🏦', 'bank', 'finance', 'money'),
  E('🏠', 'house', 'home', 'property'),
  E('🏡', 'house_with_garden', 'home', 'property'),
  E('🏢', 'office', 'building', 'company'),
  E('💰', 'moneybag', 'money', 'cash', 'wealth'),
  E('💵', 'dollar', 'money', 'cash', 'note'),
  E('💳', 'credit_card', 'card', 'payment'),
  E('💸', 'money_with_wings', 'spend', 'expense', 'loss'),
  E('🧾', 'receipt', 'invoice', 'bill'),
  E('💹', 'chart', 'growth', 'market', 'up'),
  E('📈', 'chart_with_upwards_trend', 'up', 'growth', 'increase', 'rising'),
  E('📉', 'chart_with_downwards_trend', 'down', 'decline', 'decrease', 'falling'),
  E('📊', 'bar_chart', 'chart', 'graph', 'stats', 'report'),
  E('🧮', 'abacus', 'calculate', 'maths'),
  E('⚖️', 'balance_scale', 'legal', 'law', 'balance', 'justice'),
  E('🧑‍⚖️', 'judge', 'legal', 'court'),
  E('📜', 'scroll', 'will', 'document', 'certificate'),
  E('🎓', 'mortar_board', 'graduate', 'education', 'study'),
  E('🏥', 'hospital', 'medical', 'health'),
  E('💊', 'pill', 'medicine', 'health'),
  E('🩺', 'stethoscope', 'doctor', 'medical', 'health'),
  E('🚗', 'car', 'drive', 'vehicle'),
  E('✈️', 'airplane', 'flight', 'travel', 'holiday'),
  E('🌴', 'palm_tree', 'holiday', 'vacation', 'retire'),
  E('🏖️', 'beach_umbrella', 'holiday', 'beach', 'retire'),
  E('☕', 'coffee', 'break', 'cafe', 'meeting'),
  E('🍰', 'cake', 'birthday', 'celebrate'),
  E('🎂', 'birthday', 'cake', 'celebrate'),
  E('🎁', 'gift', 'present', 'birthday'),
  E('🌱', 'seedling', 'grow', 'start', 'new'),
  E('🌳', 'deciduous_tree', 'tree', 'grow'),
  E('☀️', 'sunny', 'sun', 'weather', 'bright'),
  E('🌧️', 'cloud_with_rain', 'rain', 'weather'),
  E('⚡', 'zap', 'lightning', 'fast', 'power'),
  E('🔧', 'wrench', 'fix', 'tool', 'repair'),
  E('🛠️', 'hammer_and_wrench', 'tools', 'fix', 'build'),
  E('⚙️', 'gear', 'settings', 'process', 'config'),
  E('🧩', 'jigsaw', 'puzzle', 'piece', 'fit'),
  E('🔄', 'arrows_counterclockwise', 'refresh', 'repeat', 'sync', 'again'),
  E('➡️', 'arrow_right', 'next', 'forward'),
  E('⬅️', 'arrow_left', 'back', 'previous'),
  E('⬆️', 'arrow_up', 'up', 'increase'),
  E('⬇️', 'arrow_down', 'down', 'decrease'),
  E('🔜', 'soon', 'coming', 'upcoming'),
  E('🆕', 'new', 'fresh'),
  E('🆗', 'ok', 'okay', 'fine'),
  E('🔝', 'top', 'best', 'first'),
  E('🇦🇺', 'australia', 'flag', 'au', 'aussie'),
]

/**
 * Matches for what has been typed after the `:`. Name prefixes first, since
 * `:thu` means "the one that starts thu" more than "the one with thu in it";
 * then keyword prefixes; then anything the name or a keyword merely contains.
 * Empty input returns nothing — the picker does not open on a bare colon.
 */
export function searchEmoji(query: string, limit = 8): Emoji[] {
  const q = query.trim().toLowerCase().replace(/^:/, '').replace(/[\s-]+/g, '_')
  if (!q) return []
  const namePrefix: Emoji[] = []
  const keywordPrefix: Emoji[] = []
  const contains: Emoji[] = []
  for (const e of EMOJI) {
    const keywords = e.keywords.map((k) => k.replace(/[\s-]+/g, '_'))
    if (e.name.startsWith(q)) namePrefix.push(e)
    else if (keywords.some((k) => k.startsWith(q))) keywordPrefix.push(e)
    else if (e.name.includes(q) || keywords.some((k) => k.includes(q))) contains.push(e)
  }
  return [...namePrefix, ...keywordPrefix, ...contains].slice(0, limit)
}
