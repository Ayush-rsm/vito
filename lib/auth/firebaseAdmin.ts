import * as admin from 'firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

// Prevent multiple initialization of Firebase Admin SDK in Next.js hot-reloads
if (!admin.apps.length) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || 'vitto-loan-service';
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } else {
      // Fallback for dev/testing without active cert
      admin.initializeApp({
        projectId,
      });
    }
  } catch (err) {
    console.warn('Firebase Admin init warning:', err);
  }
}

export interface AuthenticatedUser {
  uid: string;
  email?: string;
}

export type AuthenticatedRouteHandler = (
  req: NextRequest,
  context: { params: Promise<Record<string, string>> },
  user: AuthenticatedUser
) => Promise<NextResponse>;

/**
 * Higher-order middleware wrapper for Next.js App Router route handlers.
 * Verifies Bearer token in Authorization header.
 */
export function withAuth(handler: AuthenticatedRouteHandler) {
  return async (
    req: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ): Promise<NextResponse> => {
    const authHeader = req.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication token required in Authorization header.',
          },
        },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7).trim();

    // In test environment ONLY (process.env.NODE_ENV === 'test'), allow mock test tokens for automated integration tests
    if (process.env.NODE_ENV === 'test') {
      if (token === 'invalid-token') {
        return NextResponse.json(
          {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Invalid or expired authentication token.',
            },
          },
          { status: 401 }
        );
      }
      if (token === 'test-token' || token.startsWith('mock-')) {
        return handler(req, context, {
          uid: 'test-user-123',
          email: 'test@vitto.money',
        });
      }
    }


    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      return handler(req, context, {
        uid: decodedToken.uid,
        email: decodedToken.email,
      });
    } catch (err: any) {
      return NextResponse.json(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: err.message || 'Invalid or expired authentication token.',
          },
        },
        { status: 401 }
      );
    }
  };
}
