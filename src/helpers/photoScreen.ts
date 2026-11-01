/**
 * Photo screens: the information is in the picture and the actions in the buttons.
 * Returns false when the photo could not be sent, so the caller falls back to the text screen.
 */
export async function showPhoto(ctx: any, image: Buffer, keyboard: any[], edit = false): Promise<boolean> {
  try {
    const reply_markup = { inline_keyboard: keyboard }
    const msg: any = ctx.callbackQuery && ctx.callbackQuery.message
    if (edit && msg && msg.photo) {
      try {
        await ctx.telegram.editMessageMedia(
          msg.chat.id,
          msg.message_id,
          undefined,
          { type: 'photo', media: { source: image } } as any,
          { reply_markup } as any
        )
        return true
      } catch (err) {
        if (/not modified/i.test(`${(err && (err.description || err.message)) || ''}`)) return true
      }
    }
    await ctx.replyWithPhoto({ source: image } as any, { reply_markup } as any)
    if (edit && msg) {
      try {
        await ctx.deleteMessage()
      } catch {
        // cannot delete: the old screen stays
      }
    }
    return true
  } catch (err) {
    console.error('photo screen failed', err)
    return false
  }
}
