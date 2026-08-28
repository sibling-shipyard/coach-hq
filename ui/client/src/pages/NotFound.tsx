import { AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="wi-shell">
      <div className="auth-card-shell">
        <div className="auth-card">
          <AlertCircle className="auth-card__icon" aria-hidden="true" />
          <span className="auth-card__eyebrow">404</span>
          <h1 className="auth-card__heading">Page not found</h1>
          <p className="auth-card__body">
            Sorry, the page you are looking for doesn&apos;t exist. It may have been moved or
            deleted.
          </p>
          <div className="auth-card__buttons">
            <button
              type="button"
              className="auth-card__button auth-card__button--primary"
              onClick={handleGoHome}
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
