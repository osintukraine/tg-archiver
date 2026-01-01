export default function NotFound() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="glass p-8 rounded-xl text-center">
        <h2 className="text-2xl font-bold mb-4">Message Not Found</h2>
        <p className="text-text-secondary mb-4">
          The message you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <a
          href="/"
          className="inline-block px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/80 transition-colors"
        >
          Back to Home
        </a>
      </div>
    </div>
  );
}
