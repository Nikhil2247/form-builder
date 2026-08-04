import { Metadata, ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';
import { FormRunnerClient } from './FormRunnerClient';

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { id: slug } = await params;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1'}/public-forms/${slug}`, {
      next: { revalidate: 300 }
    });
    if (!res.ok) throw new Error('Form not found');
    const json = await res.json();
    const formConfig = json.data ?? json;
    return {
      title: formConfig.title,
      description: formConfig.description,
      openGraph: {
        title: formConfig.title,
        description: formConfig.description,
      },
    };
  } catch (error) {
    return {
      title: 'Form Not Found',
    };
  }
}

export default async function PublicFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1'}/public-forms/${slug}`, {
      next: { revalidate: 300 }
    });
    
    if (!res.ok) {
      if (res.status === 404) return notFound();
      throw new Error('Failed to fetch form');
    }
    
    const formConfig = await res.json();
    return <FormRunnerClient slug={slug} initialData={formConfig} />;
  } catch (err) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <p className="text-destructive font-semibold">Failed to load form. It may have been deleted or expired.</p>
      </div>
    );
  }
}
