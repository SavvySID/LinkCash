import { ButtonLink, useFocusHeading } from "../components";

export function NotFound() {
  const headingRef = useFocusHeading();
  return (
    <div className="container container-narrow page">
      <div className="not-found">
        <h1 tabIndex={-1} ref={headingRef}>
          This page doesn't exist
        </h1>
        <p className="hint">
          The address may be mistyped, or the page may have moved. If you were opening a payment link, make sure you copied the whole link.
        </p>
        <div className="btn-row">
          <ButtonLink to="/">Back to home</ButtonLink>
          <ButtonLink to="/links" variant="secondary">
            My links
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
