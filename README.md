# Lumera Bot

لوحة تحكم عربية RTL لبوت Discord لإدارة السيرفر والأوامر والاختصارات.

## التشغيل المحلي

```bash
npm install
cp .env.example .env
npm start
```

ثم افتح `http://localhost:3000`. فحص الخدمة متاح من `http://localhost:3000/health`.

## تسجيل الدخول

سجّل `DISCORD_REDIRECT_URI` نفسه في Discord Developer Portal ضمن OAuth2 Redirects، ثم يفتح زر تسجيل الدخول حساب Discord ويصدر جلسة للداشبورد. لا تُعرض إحصاءات أو تُستخدم أدوات التحكم قبل تسجيل الدخول.

## تشغيل البوت

انسخ `.env.example` إلى `.env` وضع `DISCORD_TOKEN` و`DISCORD_CLIENT_ID` و`DISCORD_GUILD_ID` (معرّف السيرفر). استخدام `DISCORD_GUILD_ID` يجعل أوامر الإدارة تظهر فورًا داخل سيرفرك، ثم شغّل:

```bash
npm run bot
```

الأوامر المتاحة: `/clear` و`/kick` و`/ban` و`/timeout` و`/untimeout` و`/lock` و`/unlock` و`/slowmode` و`/warn` و`/role add` و`/role remove`. للأوامر العامة استخدم `/ping` و`/server` و`/invite`. للاختصارات استخدم `/shortcut add`، ثم اكتبها مع `!` مثل `!روليت`.

الأنظمة الإضافية: `/help` للمساعدة، `/profile` و`/balance` و`/daily` و`/quest` و`/leaderboard` للـXP والعملات والتقدم، `/pay` و`/shop list` و`/shop buy` و`/coinflip` و`/redeem` للاقتصاد، `/suggest` للاقتراحات والتصويت، `/create-role` لإنشاء رتبة آمنة، `/setup-logs` لإنشاء قنوات اللوق تلقائيًا، و`/custom-reply` و`/automod` للردود والحماية، و`/challenge` و`/season` للتحديات والمواسم.

لتعمل الاختصارات النصية مثل `!مسح 10`، فعّل **Message Content Intent** من Discord Developer Portal، ثم أضف `ENABLE_TEXT_SHORTCUTS=true` في `.env` وأعد تشغيل البوت. إذا تركتها `false` يظل البوت يعمل وتبقى أوامر `/shortcut` متاحة للإعداد.

لعرض الانضمامات المؤكدة عبر الدعوات، فعّل **Server Members Intent** من Discord Developer Portal، ثم أضف `ENABLE_INVITE_TRACKING=true` في `.env` وأعد تشغيل البوت. أمر `/invite` يعرض التقرير مع صورة المستخدم المصغرة.

## ما تم تجهيزه

- واجهة داشبورد عربية متجاوبة مع تسجيل دخول Discord وإدارة الأوامر.
- بوت Discord فعلي بأوامر Slash للإدارة والأوامر العامة والإنفايت.
- اختصارات إدارية قابلة للإضافة والحذف والعرض.
- أوامر إدارية محمية بصلاحيات Discord.
- نظام XP مع Cooldown، مهام يومية، Streak، عملات، تحويل، ترتيب، ولعبة Coinflip.
- اقتراحات بتصويت ومنع التصويت المتكرر، ومولّد رتب بدون صلاحيات خطرة.
- خادم HTTP خفيف مع endpoint للصحة وتسجيل حسابات لوحة التحكم، مناسب للتشغيل خلف reverse proxy.
- ملف بيئة منفصل لأسرار Discord.

## الخطوات المطلوبة للإطلاق

ربط OAuth2 الخاص بـ Discord يحتاج `DISCORD_CLIENT_ID` و`DISCORD_CLIENT_SECRET` و`DISCORD_REDIRECT_URI` من Discord Developer Portal، ثم توصيل الجلسات وقاعدة البيانات بتفضيلات كل سيرفر.

للتشغيل 24/7 استخدم Railway أو Render أو VPS مع PM2، وشغّل `npm start` للداشبورد و`npm run bot` للبوت كخدمتين دائمين. ظهور الموقع عند البحث عن `lumera bot` يحتاج دومينًا حقيقيًا، نشر الموقع، وتهيئة Search Console وSEO بعد اختيار الدومين.

### تشغيل PM2

```bash
npm install
npm run prod
pm2 save
pm2 startup
```

يعرض `npm run prod:logs` السجلات. هذا يحافظ على الخدمتين ويعيد تشغيلهما عند التعطل، بينما التشغيل 24/7 الفعلي يتطلب VPS أو Railway أو Render وعدم إيقاف الاستضافة.