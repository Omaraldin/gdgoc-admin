import { type RouteConfig, index, layout, route, prefix } from "@react-router/dev/routes";

export default [
  // Public routes
  index("routes/home.tsx"),
  route("verify/:code", "routes/verify.tsx"),
  route("auth/login", "routes/auth/login.tsx"),
  route("auth/callback", "routes/auth/callback.tsx"),
  route("auth/logout", "routes/auth/logout.tsx"),
  route("unauthorized", "routes/unauthorized.tsx"),
  route("privacy", "routes/privacy.tsx"),

  // Protected admin routes — wrapped in auth layout
  layout("layouts/admin-layout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),

    // User management (super admin only)
    ...prefix("users", [
      index("routes/users/index.tsx"),
      route(":id", "routes/users/detail.tsx"),
    ]),

    // Whitelist management (super admin only)
    ...prefix("whitelist", [
      index("routes/whitelist/index.tsx"),
    ]),

    // Chapter management
    ...prefix("chapters", [
      index("routes/chapters/index.tsx"),
      route("new", "routes/chapters/new.tsx"),
      route(":id", "routes/chapters/detail.tsx"),
      route(":id/edit", "routes/chapters/edit.tsx"),
    ]),

    // Certificate templates
    ...prefix("templates", [
      index("routes/templates/index.tsx"),
      route("public", "routes/templates/public.tsx"),
      route("new", "routes/templates/new.tsx"),
      route(":id", "routes/templates/detail.tsx"),
      route(":id/editor", "routes/templates/editor.tsx"),
      route(":id/versions", "routes/templates/versions.tsx"),
    ]),

    // Defined Functions library (script formulas)
    route("functions", "routes/batches/functions.tsx"),

    // Certificate issuance
    ...prefix("batches", [
      index("routes/batches/index.tsx"),
      route("new", "routes/batches/new.tsx"),
      route(":id", "routes/batches/detail.tsx"),
      route(":id/recipients", "routes/batches/recipients.tsx"),
      route(":id/certificates", "routes/batches/certificates.tsx"),
    ]),

    // Certifications (grouped by cert_name — chapter leaders only)
    route("certifications", "routes/certifications.tsx"),

    // Certification metadata management (chapter members only)
    route("cert-metadata", "routes/cert-metadata/index.tsx"),

    // Email
    ...prefix("mail", [
      index("routes/mail/index.tsx"),
      route("compose", "routes/mail/compose.tsx"),
      ...prefix("templates", [
        index("routes/mail/templates/index.tsx"),
        route("new", "routes/mail/templates/new.tsx"),
        route(":id/edit", "routes/mail/templates/edit.tsx"),
      ]),
    ]),

    // Dynamic Images
    ...prefix("dynamic-images", [
      index("routes/dynamic-images/index.tsx"),
      route("new", "routes/dynamic-images/new.tsx"),
      route(":id", "routes/dynamic-images/detail.tsx"),
      route(":id/editor", "routes/dynamic-images/editor.tsx"),
    ]),

    // Font Library
    route("fonts", "routes/fonts/index.tsx"),
  ]),
] satisfies RouteConfig;
