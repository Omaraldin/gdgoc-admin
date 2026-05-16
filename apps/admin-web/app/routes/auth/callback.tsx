// The backend handles the OAuth callback directly.
// If somehow the frontend receives this route, redirect home.
import { redirect } from "react-router";

export function clientLoader() {
  return redirect("/dashboard");
}

export default function CallbackPage() {
  return null;
}
