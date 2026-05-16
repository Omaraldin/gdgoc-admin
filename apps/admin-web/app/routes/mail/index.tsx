import { Link } from "react-router";
import { Mail, FileText } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Mail | GDGoC Admin" }];
}

export default function MailPage() {
  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">Email</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link to="/mail/compose">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5 flex flex-col gap-2">
              <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <span className="font-semibold text-foreground">Compose Email</span>
              <span className="text-sm text-muted-foreground">Send a one-off email to recipients</span>
            </CardContent>
          </Card>
        </Link>
        <Link to="/mail/templates">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5 flex flex-col gap-2">
              <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <span className="font-semibold text-foreground">Mail Templates</span>
              <span className="text-sm text-muted-foreground">Create and manage reusable email templates with dynamic fields</span>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

