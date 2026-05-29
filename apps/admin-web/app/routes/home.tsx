import { Link } from "react-router";

export function meta() {
  return [{ title: "GDGoC Admin" }];
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--canvas)] px-6 py-12 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-10 rounded-[2rem] border border-slate-200 bg-white/95 p-10 shadow-xl shadow-slate-200/40 backdrop-blur">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">GDGoC Admin</p>
          <h1 className="text-5xl font-semibold tracking-tight text-slate-900 sm:text-6xl">
            GDGoC Admin
          </h1>
          <p className="max-w-3xl text-xl leading-8 text-slate-700">
            A chapter administration portal for Google Developer Groups on Campus. Manage certificate templates, issue certificates in bulk, and send email with Google OAuth-powered SMTP in one place.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">What it does</h2>
            <ul className="mt-4 space-y-3 text-slate-700">
              <li>• Create and manage certificate templates</li>
              <li>• Issue certificates to recipients in bulk</li>
              <li>• Configure chapter SMTP and send email</li>
              <li>• Authenticate chapter admins via Google OAuth</li>
            </ul>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Privacy & verification</h2>
            <p className="mt-4 text-slate-700">
              This site includes an accessible privacy policy and clearly states the app purpose required for OAuth verification. The app name shown here matches the Google OAuth consent screen.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/auth/login"
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Sign in
              </Link>
              <Link
                to="/privacy"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Privacy policy
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
