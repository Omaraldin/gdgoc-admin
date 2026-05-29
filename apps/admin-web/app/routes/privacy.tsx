import { Link } from "react-router";

export function meta() {
  return [{ title: "Privacy Policy | GDGoC Admins - Mail Service" }];
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--canvas)] px-6 py-12 text-slate-900">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white/90 p-10 shadow-xl shadow-slate-200/40 backdrop-blur">
        <div className="mb-8">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900">Privacy Policy</h1>
          <p className="mt-3 text-base text-slate-600">
            GDGoC Admins - Mail Service respects your privacy and is committed to protecting the data used to authenticate and operate the application.
          </p>
        </div>

        <section className="space-y-4 text-slate-700">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">What this app does</h2>
            <p>
              GDGoC Admins - Mail Service is an administrative dashboard for Google Developer Groups on Campus chapters. It helps authorized chapter admins design certificate templates, issue certificates in bulk, manage chapters, and send email using Google SMTP OAuth.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Information collected</h2>
            <p>
              The application uses Google OAuth for authentication. It collects the minimum profile data required to sign in and verify chapter admin access. It does not sell personal information.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">How data is used</h2>
            <p>
              Google account information is used to authenticate users and authorize chapter admins. If chapter email sending is enabled, OAuth tokens may be used to connect to Gmail for outgoing mail delivery.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">Your choices</h2>
            <p>
              You may revoke Google OAuth access from your Google account settings at any time. If you have questions, please contact the app maintainer through your chapter administration channels.
            </p>
          </div>
        </section>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Back to home
          </Link>
          <span className="text-sm text-slate-500">GDGoC Admins - Mail Service</span>
        </div>
      </div>
    </main>
  );
}
