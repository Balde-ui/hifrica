import { Link } from "../router.js";
import { useSession } from "../session.js";

export function Landing() {
  const { user } = useSession();
  return (
    <>
      <section className="hero">
        <div>
          <span className="badge badge-ok">CADEV 2026 · Open source</span>
          <h1 style={{ marginTop: "0.8rem" }}>Testez vos paiements mobiles, USSD et SMS sans compte marchand.</h1>
          <p className="lead">
            Hifrica fournit des simulateurs communautaires décrits en YAML : votre app appelle une API de test, reçoit de
            vraies réponses et des webhooks signés, et vous jouez les scénarios d'échec avant la mise en production.
          </p>
          <div className="row" style={{ marginTop: "1.2rem" }}>
            <Link to={user ? "/app" : "/inscription"} className="btn btn-primary btn-lg">
              {user ? "Ouvrir mes projets" : "Commencer gratuitement"}
            </Link>
            <Link to="/catalogue" className="btn btn-lg">
              Parcourir le catalogue
            </Link>
          </div>
        </div>
        <div className="card">
          <h3>Votre premier test en moins de 5 minutes</h3>
          <ol className="steps" style={{ marginTop: "0.9rem" }}>
            <li>Créez un compte et un projet.</li>
            <li>Générez une clé de test <code>sk_test_…</code>.</li>
            <li>Choisissez un simulateur dans le catalogue.</li>
            <li>Appelez-le depuis votre app ou depuis la console.</li>
            <li>Activez « solde insuffisant » et vérifiez que votre code gère l'erreur.</li>
          </ol>
        </div>
      </section>
      <section className="grid grid-3" style={{ marginTop: "1rem" }}>
        <div className="card feature">
          <span className="badge badge-info">Catalogue</span>
          <h3>Des simulateurs partagés</h3>
          <p className="muted">Paiement mobile, USSD et SMS, publiés et forkés par la communauté, documentés automatiquement.</p>
        </div>
        <div className="card feature">
          <span className="badge badge-info">Éditeur</span>
          <h3>Un YAML validé en direct</h3>
          <p className="muted">Coloration, erreurs soulignées à la ligne près, même schéma que le moteur et l'assistant IA.</p>
        </div>
        <div className="card feature">
          <span className="badge badge-info">Console</span>
          <h3>Chaque appel journalisé</h3>
          <p className="muted">Méthode, chemin, statut, durée et scénario de chaque requête reçue par vos simulateurs.</p>
        </div>
      </section>
    </>
  );
}
