// Command that starts a raffle (default /start), configurable with START_COMMAND
export const START_COMMAND = (process.env.START_COMMAND || 'start')
  .replace(/^\//, '')
  .trim()

export function loc(text: string, language: string) {
  const value = localizations[text][language] || localizations[text].en
  return value
    .replace(/\/start\b/g, `/${START_COMMAND}`)
    .replace(/@BOTUSERNAME\b/g, `@${process.env.USERNAME}`)
}

export const localizations: { [index: string]: { [index: string]: string } } = {
  public_help_start: {
    en:
      "Hi! I pick random winners among the people who press the \"Participate\" button in a group or a channel.\n\n1. Add me to your group or channel as an admin and send /start to start a raffle.\n2. Reply with any message to the raffle message to finish it and pick the winner.\n\n*Settings:*\n/number — number of winners (e.g. `/number 3`)\n/language — change the language\n/subscribe — require a channel subscription to participate (e.g. `/subscribe @channel`); /nosubscribe turns it off\n/raffleMessage and /noRaffleMessage — custom or default raffle message\n/winnerMessage and /noWinnerMessage — custom or default winner message\n/nodelete — keep the original raffle message instead of editing it\n/setentryvalue — value of each entry for special days (e.g. `/setentryvalue 1.5`)\n\n*Configure from private messages:* forward me a message from your group or channel (or use `/addChat @channel`), choose it with /configRaffle and send the settings here.",
    es:
      "¡Hola! Elijo ganadores al azar entre quienes pulsan el botón \"Participar\" en un grupo o canal.\n\n1. Añádeme como admin a tu grupo o canal y envía /start para empezar un sorteo.\n2. Responde con cualquier mensaje al mensaje del sorteo para cerrarlo y elegir al ganador.\n\n*Ajustes:*\n/number — número de ganadores (ej. `/number 3`)\n/language — cambiar el idioma\n/subscribe — exigir suscripción a un canal para participar (ej. `/subscribe @canal`); /nosubscribe lo desactiva\n/raffleMessage y /noRaffleMessage — mensaje del sorteo personalizado o estándar\n/winnerMessage y /noWinnerMessage — mensaje del ganador personalizado o estándar\n/nodelete — conservar el mensaje original del sorteo en vez de editarlo\n/setentryvalue — valor de cada entrada para días especiales (ej. `/setentryvalue 1.5`)\n\n*Configurar desde privado:* reenvíame un mensaje de tu grupo o canal (o usa `/addChat @canal`), elígelo con /configRaffle y envíame aquí los ajustes.",
  },
  no_work_private: {
    ru: 'Простите, но эта команда не работает в личке с ботом.',
    en: 'Sorry, but this command is not available in private messages.',
    pt: 'Desculpe, mas este comando não está disponível em conversas privadas.',
    tr: 'Üzgünüm, bu komut özel mesajlarda kullanılamaz.',
    uk: 'Вибачте, але ця команда не працює в діалозі з ботом.',
    ar: 'عذراً، ولكن هذا الأمر غير متوفر في الرسائل الخاصة.',
    es:
      'Lo sentimos, pero este comando no está disponible en mensajes privados.',
  },
  select_language: {
    ru: 'Пожалуйста, выберите язык',
    en: 'Please, select the language',
    pt: 'Por favor, escolha o idioma',
    tr: 'Lütfen dilinizi seçiniz',
    uk: 'Будь ласка, оберіть мову',
    ar: 'الرجاء تحديد اللغة',
    es: 'Selecciones el lenguaje',
  },
  language_selected: {
    ru: 'Спасибо, теперь я говорю по-русски!',
    en: 'Thank you! Now I speak English',
    pt: 'Obrigado! Agora eu falarei português',
    tr: 'Teşekkürler! Artık Türkçe konuşuyorum',
    uk: 'Дякую, тепер я говорю українською!',
    ar: 'شكرا! الآن أنا أتكلم العربية',
    es: 'Gracias! Ahora hablo Español',
  },
  raffle_text: {
    ru:
      'Розыгрыш начался! Нажмите на кнопку ниже, чтобы принять участие. Победитель будет выбран случайным образом из участников, когда администраторы ответят на это сообщение. Желаю удачи!',
    en:
      'Raffle has begun! Press the button below to participate. The winner will be randomly selected from the participants when an admin replies to this message. Good luck!',
    pt:
      'O sorteio começou! Toque no botão abaixo para participar. O vencedor será selecionado aleatoriamente dentre participantes quando um administrador responder a essa mensagem. Boa sorte!',
    tr:
      'Çekilis basladı! Katılmak için aşağıdaki butona basın. Bir yönetici bu mesaja cevap verdiğinde kazanan kişi, katılımcılar arasından rastgele olarak seçilecektir. İyi şanslar!',
    uk:
      'Розіграш розпочався! Натисніть на кнопку нижче, щоб взяти участь. Переможець буде обраний випадковим чином з учасників, коли адміністратори дадуть відповідь на це повідомлення. Бажаю удачі!',
    ar:
      'لقد بدأ السحب! اضغط على الزر أدناه للمشاركة. سيتم اختيار الفائز بشكل عشوائي من بين المشاركين عند رد المشرف على هذه الرسالة. حظ سعيد!',
    es:
      '¡La rifa ha comenzado! Presione el botón de abajo para participar. El ganador será seleccionado al azar de los participantes cuando un administrador responda a este mensaje. ¡Buena suerte!',
  },
  raffle_text_multiple: {
    ru:
      'Розыгрыш начался! Нажмите на кнопку ниже, чтобы принять участие. Победители будут выбраны случайным образом из участников, когда администраторы ответят на это сообщение. Желаю удачи!',
    en:
      'Raffle has begun! Press the button below to participate. The winners will be randomly selected from the participants when an admin replies to this message. Good luck!',
    pt:
      'O sorteio começou! Toque no botão abaixo para participar. Os vencedores serão selecionados aleatoriamente dentre os participantes quando um administrador responder a esta mensagem. Boa sorte!',
    tr:
      'Çekilis basladı! Katılmak için aşağıdaki butona basın. Bir yönetici bu mesaja cevap verdiğinde kazanan kişi, katılımcılar arasından rastgele olarak seçilecektir. İyi şanslar!',
    uk:
      'Розіграш розпочався! Натисніть на кнопку нижче, щоб взяти участь. Переможці будуть обрані випадковим чином з учасників, коли адміністратори дадуть відповідь на це повідомлення. Бажаю удачі!',
    ar:
      'لقد بدأ السحب! اضغط على الزر أدناه للمشاركة. سيتم اختيار الفائزين بشكل عشوائي من بين المشاركين عند رد المشرف على هذه الرسالة. حظ سعيد!',
    es:
      '¡La rifa ha comenzado! Presione el botón de abajo para participar. Los ganadores serán seleccionados al azar de los participantes cuando un administrador responda a este mensaje. ¡Buena suerte!',
  },
  please_retry: {
    ru: 'Пожалуйста, попробуйте через пару минут',
    en: 'Please, try in a couple of minutes',
    pt: 'Por favor, tente novamente daqui a alguns instantes',
    tr: 'Lütfen, birkaç dakika içerisinde tekrar deneyiniz',
    uk: 'Будь ласка, спробуйте за декілька хвилин',
    ar: 'من فضلك، حاول في بضع دقائق',
    es: 'Por favor, reintente en un par de minutos',
  },
  already_participating: {
    ru: 'Вы уже принимаете участие, отлично!',
    en: 'You are already participating, wonderful!',
    pt: 'Você já está participando. Muito bem!',
    tr: 'Zaten çekilişe katıldınız, geriye kazanmak kaldı!',
    uk: 'Ви вже берете участь, чудово!',
    ar: 'كنت تشارك بالفعل، رائع!',
    es: 'Ya estas participando, ¡maravilloso!',
  },
  participated: {
    ru: 'Отлично, вы отметились, как участник!',
    en: 'Great, you are now participating in this raffle!',
    pt: 'Muito bem, vocês agora está participando do sorteio!',
    tr: 'Harika, cekilişe katıldınız!',
    uk: 'Відмінно, ви відзначилися, як учасник!',
    ar: 'عظيم، أنت الآن تشارك في هذا السحب!',
    es: '¡Genial, ahora estás participando en este sorteo!',
  },
  participants_number: {
    ru: 'Количество участников',
    en: 'Number of participants',
    pt: 'Número de participantes',
    tr: 'Katılımcı sayısı',
    uk: 'Кількість учасників',
    ar: 'عدد المشاركين',
    es: 'Cantidad de participantes',
  },
  participate_button: {
    ru: 'Участвовать!',
    en: 'Participate!',
    pt: 'Participar!',
    tr: 'Katıl!',
    uk: 'Взяти участь!',
    ar: 'المشاركة!',
    es: '¡Participar!',
  },
  no_participants: {
    ru: 'В этот раз участников розыгрыша не было 😅',
    en: 'No participants this time 😅',
    pt: 'Sem participantes dessa vez 😅',
    tr: 'Katılımcı yok 😅',
    uk: 'Цього разу учасників розіграшу не було 😅',
    ar: 'لا يوجد مشاركون هذه المرة 😅',
    es: 'No hay suficientes participantes esta vez 😅',
  },
  winner: {
    ru: 'В этот раз победитель',
    en: 'The winner is',
    pt: 'O vencedor é',
    tr: 'Ve Kazanan kişi',
    uk: 'Цього разу переможець',
    ar: 'الفائز هو',
    es: 'El ganador es',
  },
  winners: {
    ru: 'В этот раз победители',
    en: 'The winners are',
    pt: 'Os ganhadores são',
    tr: 'Ve Kazanan kişiler',
    uk: 'Цього разу переможці',
    ar: 'الفائزون هم',
    es: 'Los ganadores son',
  },
  congratulations: {
    ru: 'Поздравляем',
    en: 'Congratulations',
    pt: 'Parabéns',
    tr: 'Tebrikler',
    uk: 'Вітаємо',
    ar: 'تهانينا',
    es: 'Felicidades',
  },
  raffle_over: {
    ru: 'Простите, но розыгрыш уже закончен',
    en: 'Sorry, the raffle is over now',
    pt: 'Pedimos desculpas, mas o sorteio terminou',
    tr: 'Üzgünüm, çekiliş şimdi bitti',
    uk: 'Вибачте, але розіграш вже завершено',
    ar: 'آسف، السحب إنتهى الآن',
    es: 'Lo siento, el sorteo ya terminó',
  },
  select_number: {
    ru: 'Пожалуйста, выберите, сколько победителей должно быть в розыгрыше',
    en: 'Please, select number of winners for a raffle',
    pt: 'Por favor selecione o número de ganhadores do sorteio',
    tr: 'Lütfen çekiliş için kazanacak kişi sayısını seçiniz',
    uk: 'Будь ласка, виберіть, скільки переможців має бути в розіграші',
    ar: 'من فضلك، اختر عدد الفائزين للسحب',
    es: 'Por favor, seleccione el número de ganadores para el sorteo',
  },
  number_selected: {
    ru: 'Отлично, вы выбрали количество победителей!',
    en: "Great! You've selected the number of winners!",
    pt: 'Ótimo! Você selecionou o número de ganhadores!',
    tr: 'Harika! Kazanacak kişi sayısını belirledin!',
    uk: 'Чудово, ви вибрали кількість переможців!',
    ar: 'رائع ! لقد اخترت عدد الفائزين!',
    es: '¡Excelente! ¡Has seleccionado el número de ganadores!',
  },
  not_enough_participants: {
    ru: 'В этот раз участников розыгрыша было недостаточно 😅',
    en: 'Not enough participants this time 😅',
    pt: 'Sem participantes suficientes 😅',
    tr: 'Çekiliş için yeteri kadar katılımcı yok 😅',
    uk: 'Цього разу учасників розіграшу було недостатньо 😅',
    ar: 'لا يكفي المشاركين هذه المرة 😅',
    es: 'No hay suficientes participantes esta vez 😅',
  },
  subscribe_format: {
    ru:
      'Пожалуйста, укажите хендл канала, на который надо проверять подписку, в формате `/subscribe @channel_handle`, `/subscribe @channel_handle, @another_channel, @and_another_one`.',
    en:
      'Please, set the channel to check subscription to with the format `/subscribe @channel_handle`, `/subscribe @channel_handle, @another_channel, @and_another_one`.',
    tr:
      'Lütfen, aboneliğini kontrol ettirmek istediğiniz kanalı/kanalları şu formatta belirleyiniz: `/subscribe @kameraonu`, `/subscribe @kanal_adi, @baska_kanal, @ve_baskabir_kanal`.',
    es:
      'Por favor, configure el canal para verificar la suscripción con el formato `/subscribe @channel_handle`, `/subscribe @channel_handle, @another_channel, @and_another_one`.',
  },
  nosubscribe_success: {
    ru: 'Ренди не будет проверять подписку на какой-либо канал.',
    en: 'The bot will not check subscription.',
    tr: 'Bot artık aboneliği kontrol etmeyecek.',
    es: 'El bot no verificará la suscripción.',
  },
  bot_not_admin: {
    ru: 'Пожалуйста, сделайте @BOTUSERNAME админом в этом чате.',
    en: 'Please make @BOTUSERNAME an admin in this chat.',
    tr: 'Lütfen, @BOTUSERNAME u yönetici yapın',
    es: 'Por favor, haga de @BOTUSERNAME un administrador en este grupo.',
  },
  bot_not_admin_chat: {
    en: 'Please make @BOTUSERNAME an admin in the chat ',
    tr: 'Lütfen, @BOTUSERNAME u yönetici yapın',
    es: 'Por favor, haga de @BOTUSERNAME un administrador en este chat.',
    ru: 'Пожалуйста, сделайте @BOTUSERNAME админом в этом чате',
  },
  subscribe_success: {
    ru:
      'Отлично, теперь бот будет проверять подписку пользователя на следующий канал перед разрешением участвовать в конкурсе: ',
    en:
      'Great, now bot will check if the participant is subscribed to the following channel before allowing to participate: ',
    tr:
      'Harika! şimdi bot, katılımcının çekilişe katılmasına izin vermeden önce aşağıdaki kanala abone olup olmadığını kontrol edecek:',
    es:
      'Genial, ahora el bot verificará si el participante está suscrito al siguiente canal antes de permitir participar:',
  },
  check_subscription: {
    ru: 'Вы должны быть подписаны на ',
    en: 'You should be subscribed to ',
    tr: 'Abone olmalısınız ',
    es: 'Deberías estar suscrito',
  },
  raffle_message: {
    en:
      'Reply to this message to setup a custom raffle message. Make sure to reply to this message (we hope everyone knows what the word "reply" means by now). Make sure to include "$numberOfParticipants" without quotation marks in your message — it won\'t work without it. Cheers! 💪 The current raffle message (if set) is below.',
    tr:
      'Özel bir çekiliş mesajı ayarlamak için bu iletiyi yanıtlayın. Bu iletiyi yanıtladığınızdan emin olun (umarız herkes "yanıt" kelimesinin ne anlama geldiğini biliyordur). İletinizde tırnak işaretleri olmadan "$numberOfParticipants" mesajının geçtiğinden emin olun — onsuz çalışmaz. Kapiş! 💪 Geçerli çekiliş mesajı (ayarlanmışsa) aşağıdadır:',
    es:
      'Responda a este mensaje para configurar un mensaje de rifa personalizado. Asegúrese de responder a este mensaje (esperamos que todos sepan lo que significa la palabra "responder" en este momento). Asegúrese de incluir "$ numberOfParticipants" sin comillas en su mensaje; no funcionará sin él. ¡Saludos! 💪 El mensaje de la rifa actual (si está configurado) está debajo.',
    ru:
      'Ответьте на это сообщение, чтобы установить новое сообщение розыгрыша. Именно ответьте (надеемся, что все понимают разницу между обычным сообщением и ответом). Обязательно используйте "$numberOfParticipants" без кавычек в сообщении — иначе установка не сработает. Удачи! 💪 Текущее сообщение (если оно установленно), приведено ниже.',
  },
  raffle_message_off: {
    ru: 'Теперь Ренди будет использовать стандартное сообщение о розыгрыше.',
    en: 'The bot will use standard raffle message now.',
    tr: 'Bot artık varsayılan çekiliş mesajını kullanacak.',
    es: 'El bot usará el mensaje estándar de la rifa ahora.',
  },
  winner_message: {
    en:
      'Reply to this message to setup a custom winner message. Make sure to reply to this message (we hope everyone knows what the word "reply" means by now). Make sure to include "$numberOfParticipants" and "$winner" without quotation marks in your message — it won\'t work without it. Cheers! 🎉 The current winner message (if set) is below.',
    tr:
      'Özel bir kazanan mesajı ayarlamak için bu iletiyi yanıtlayın. Bu iletiyi yanıtladığınızdan emin olun (umarız herkes "yanıt" kelimesinin ne anlama geldiğini biliyordur). İletinizde tırnak işaretleri olmadan  "$numberOfParticipants" ve "$winner" mesajının geçtiğinden emin olun —  onlarsız çalışmaz. Kapiş! 🎉 Geçerli kazanan mesajı (ayarlanmışsa) aşağıdadır:',
    es:
      'Responda a este mensaje para configurar un mensaje de ganador personalizado. Asegúrese de responder a este mensaje (esperamos que todos sepan lo que significa la palabra "responder" en este momento). Asegúrese de incluir "$ numberOfParticipants" y "$ ganador" sin comillas en su mensaje; no funcionará sin él. ¡Saludos! 🎉 El mensaje del ganador actual (si está configurado) está debajo.',
    ru:
      'Ответьте на это сообщение, чтобы установить новое сообщение о победе. Именно ответьте (надеемся, что все понимают разницу между обычным сообщением и ответом). Обязательно используйте "$numberOfParticipants" и "$winner" без кавычек в сообщении — иначе установка не сработает. Удачи! 🎉 Текущее сообщение (если оно установленно), приведено ниже.',
  },
  winner_message_off: {
    ru: 'Теперь Ренди будет использовать стандартное сообщение о победе.',
    en: 'The bot will use standard winner message now.',
    tr: 'Bot artık varsayılan kazanan mesajını kullanacak.',
    es: 'El bot usará el mensaje estándar del ganador ahora.',
  },
  success: {
    ru: 'Успех!',
    en: 'Success!',
    tr: 'Başarılı!',
    es: '¡Logrado!',
  },
  nodelete_true: {
    ru: 'Теперь Ренди не будет редактировать (удалять) оригинальное сообщение.',
    en: 'Now the bot will not edit (delete) original message.',
    es: 'Ahora el bot no editará (eliminará) el mensaje original.',
    tr: 'Bot artık orijinal mesajı düzenlemeyecek (silmeyecek).',
  },
  nodelete_false: {
    ru: 'Теперь Ренди будет редактировать (удалять) оригинальное сообщение.',
    en: 'Now the bot will edit (delete) original message.',
    es: 'Ahora el bot editará (eliminará) el mensaje original.',
    tr: 'Bot artık orijinal mesajı düzenleyecek (silecek).',
  },
  mustBeAnAdmin: {
    en: 'You have to be an admin in the chat',
    ru: 'Вы должны быть админом в чате',
  },
  config_raffle_instructions: {
    en:
      'Success! Now select the chat or the channel you want to configure with /configRaffle',
    ru:
      'Успех! Теперь выберите канал или чат, который хотите настроить, при помощи команды /configRaffle',
  },
  config_raffle_no_chats: {
    en:
      'First, forward me a message from a channel or a chat you want to configure',
    ru:
      'Сначала перешлите мне форвард сообщения из чата или канала, который хотите настроить',
  },
  select_chat: {
    en: 'Select a chat or a channel to configure',
    ru: 'Выберите чат или канал, который хотите настроить',
  },
  private_messages: {
    en: 'Private messages',
    ru: 'Приватные сообщения',
  },
  now_editing_this_chat: {
    en: 'Great! Now you are editting the config of this chat',
    ru: 'Отлично! Теперь вы редактируете настройки этого чата',
  },
  boost_help: {
    en: '⭐ *Stars boost:* use /boost to let participants buy extra chances with Telegram Stars. The raffle message shows a Boost button and says boosts are active. Run /boost again to turn it off.',
    es: '⭐ *Boost con Stars:* usa /boost para que los participantes puedan comprar más probabilidad con Telegram Stars. El mensaje del sorteo muestra un botón Boost e indica que los boosts están activos. Vuelve a usar /boost para desactivarlo.',
  },
  boost_true: {
    en: '🚀 Stars boost ON for new raffles: $price⭐ = $mult. Participants will see it on the raffle message.',
    es: '🚀 Boost con Stars ACTIVADO para los nuevos sorteos: $price⭐ = $mult. Los participantes lo verán en el mensaje del sorteo.',
  },
  boost_false: {
    en: 'Stars boost OFF for new raffles.',
    es: 'Boost con Stars DESACTIVADO para los nuevos sorteos.',
  },
  boost_note: {
    en: '🚀 Boost active: each $price⭐ = $mult (max $max per person).',
    es: '🚀 Boost activo: cada $price⭐ = $mult (máx. $max por persona).',
  },
  boost_button: {
    en: '🚀 Boost',
    es: '🚀 Boost',
  },
  boost_invoice_title: {
    en: 'Raffle boost $pct',
    es: 'Boost de sorteo $pct',
  },
  boost_invoice_description: {
    en: '$pct in this raffle. You will have $mult in total ($after/$max boosts).',
    es: '$pct en este sorteo. Tendrás $mult en total ($after/$max boosts).',
  },
  boost_disabled: {
    en: 'Boost is not active for this raffle.',
    es: 'El boost no está activo en este sorteo.',
  },
  boost_join_first: {
    en: 'Join the raffle first, then boost.',
    es: 'Primero participa en el sorteo y después haz boost.',
  },
  boost_max: {
    en: 'That goes over the maximum of $max boosts per person in this raffle.',
    es: 'Eso supera el máximo de $max boosts por persona en este sorteo.',
  },
  entry_one: {
    en: 'entry',
    es: 'entrada',
  },
  entry_many: {
    en: 'entries',
    es: 'entradas',
  },
  entry_special: {
    en: '🔥 Special giveaway: every entry counts as $value!',
    es: '🔥 Sorteo especial: ¡cada entrada vale $value!',
  },
  entries_total: {
    en: '🎟 $total entries',
    es: '🎟 $total entradas',
  },
  entry_value_set: {
    en: '✅ Entry value set to $value for new raffles. Use /setentryvalue 1 to go back to normal.',
    es: '✅ Valor de entrada fijado en $value para los nuevos sorteos. Usa /setentryvalue 1 para volver a lo normal.',
  },
  entry_value_format: {
    en: 'Current entry value: $value. Use /setentryvalue followed by a number from 1 to 10, e.g. /setentryvalue 1.5',
    es: 'Valor de entrada actual: $value. Usa /setentryvalue seguido de un número del 1 al 10, ej. /setentryvalue 1.5',
  },
  boost_first: {
    en: '🎟 No boosts yet',
    es: '🎟 Aún sin boosts',
  },
  boost_count: {
    en: '🎟 $n boosted entries',
    es: '🎟 $n entradas con boost',
  },
  winner_boosted: {
    en: '🚀 The winner used Boost: $stars⭐ ($mult).',
    es: '🚀 El ganador usó Boost: $stars⭐ ($mult).',
  },
  winner_free: {
    en: '🎟 The winner joined for free, no Boost.',
    es: '🎟 El ganador participó gratis, sin Boost.',
  },
  winners_boost_summary: {
    en: '🚀 = used Boost · $k of $total winners boosted',
    es: '🚀 = usó Boost · $k de $total ganadores hicieron boost',
  },
  boost_choose: {
    en: '🚀 Choose your boost for this raffle.\nFree = $free. Each ⭐ = $step.\nYou have: $mult ($used/$max boosts).',
    es: '🚀 Elige tu boost para este sorteo.\nGratis = $free. Cada ⭐ = $step.\nTienes: $mult ($used/$max boosts).',
  },
  boost_applied: {
    en: '🚀 Boost applied! You now have $mult in this raffle ($used/$max boosts).',
    es: '🚀 ¡Boost aplicado! Ahora tienes $mult en este sorteo ($used/$max boosts).',
  },
  boost_refunded: {
    en: 'Your Stars have been refunded.',
    es: 'Te hemos devuelto las Stars.',
  },
  boost_refund_failed: {
    en: 'We could not refund automatically, please contact the bot admin.',
    es: 'No pudimos devolver las Stars automáticamente, contacta con el admin del bot.',
  },
}
