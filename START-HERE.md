# 🏌️ Get Your Golf Pool Online — 10 Easy Steps

**Time:** about 20 minutes · **Cost:** $0 · **You need:** a computer, internet, and an email.

Good news: **everything is already in the right folder with the right name.**
You do NOT rename anything. You do NOT type code. Just follow the 10 steps. ✅

---

## STEP 1 — Unzip the folder
Double-click the file you downloaded (`fedex-pool.zip`) to unzip it.
You now have a folder called **`fedex-pool`**. That's the whole app. Don't touch what's inside. 🎁

## STEP 2 — Make 3 free accounts (use the same email for all)
Open these 3 websites in your browser and click **Sign up** on each:
1. **https://github.com** — the box that holds the app 📦
2. **https://supabase.com** — the brain that remembers scores 🧠
3. **https://vercel.com** — puts the app on the internet 🌐

Tip: on Supabase and Vercel, click **"Continue with GitHub"** so it's one click. 🙌

## STEP 3 — Put the folder on GitHub
1. On GitHub, click the **+** (top right) → **New repository**.
2. Name it `golf-pool` → click the green **Create repository**.
3. Click the blue link **uploading an existing file**.
4. Open your `fedex-pool` folder, select **everything inside**, and **drag it all** into the box.
5. Click the green **Commit changes** button. ✅

## STEP 4 — Make the brain (Supabase project)
1. On Supabase click **New project**.
2. Name it `golf-pool`, make a password (**write it on paper** 📝), pick the closest region, click **Create new project**.
3. Wait ~2 minutes for it to build. ⏳ (Snack time! 🍪)

## STEP 5 — Turn on the brain (run the setup file)
1. In Supabase, on the left click **SQL Editor** → **New query**.
2. Open the file `supabase/schema.sql` from your folder, copy **everything**, paste it in the big box.
3. Click the green **Run** button. You'll see **Success**. 🎉

## STEP 6 — Grab your 3 secret keys
1. In Supabase, click the **gear icon (Settings)** → **API**.
2. Leave this tab open. You'll copy these three in Step 8:
   - **Project URL**
   - **anon public** key
   - **service_role** key (secret! 🤫)

## STEP 7 — Start putting it online (Vercel)
1. On Vercel click **Add New… → Project**.
2. Find `golf-pool` in the list → click **Import**.

## STEP 8 — Paste the 4 keys, then Deploy
Before clicking Deploy, click **Environment Variables** and add these 4
(type the Name exactly, paste the Value):

| Name (type exactly) | Value |
|---------------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | your **Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your **anon public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | your **service_role** key |
| `CRON_SECRET` | make up a long word like `bananas12345golfpool` |

💡 No DataGolf key needed — the app uses **free ESPN data** by itself.

Now click the big blue **Deploy** button. Wait ~2 minutes. When you see **confetti 🎉**, click **Visit**. Your app is LIVE! 🥳

## STEP 9 — Make an account on your new website
On your live site, click **Sign up** and make an account with your email.

## STEP 10 — Make yourself the boss (Commissioner) 👑
1. Go back to Supabase → **SQL Editor** → **New query**.
2. Paste this, but change the email to **your** email:
   ```sql
   update profiles set role = 'commissioner' where email = 'YOUR-EMAIL-HERE@example.com';
   ```
3. Click **Run**, then refresh your website. You now see the **Admin** button. Done! 👑

---

## 🎉 That's it!
Your golf pool is now on the internet, remembers everyone's picks, updates
scores by itself every few minutes, and works on any phone or computer — 100% free.

## 🆘 If something breaks
- **Red error when Vercel builds?** Re-upload the folder — make sure you dragged
  *everything inside* `fedex-pool` (including the folders `app`, `lib`, `supabase`), not the outer folder itself.
- **Key error?** Recheck the 4 names/values in Step 8 are exact.
- **No scores?** That only happens during a live tournament AND when you set a week
  to **"active"** in the Admin page. Off-season = empty is normal.
- **Still stuck?** Copy the error and paste it back to me — I'll fix it.

## ✅ Checklist
- [ ] Unzipped the folder
- [ ] Made GitHub, Supabase, Vercel accounts
- [ ] Uploaded folder to GitHub
- [ ] Created Supabase project
- [ ] Ran `schema.sql` (saw Success)
- [ ] Copied 3 keys
- [ ] Imported project on Vercel
- [ ] Pasted 4 keys + Deployed (saw confetti 🎉)
- [ ] Signed up on the site
- [ ] Made myself commissioner 👑
