import { cookies } from 'next/headers';
import { logAuditAction } from '../../../../lib/auditLog.mjs';

// GET endpoint - fetch recipe details
export async function GET(request, { params }) {
  const { slug } = params;
  // In production, this would query a database
  // For now, return a placeholder indicating the endpoint exists
  return Response.json({
    success: true,
    message: 'Recipe fetch endpoint',
    slug
  });
}

// PUT endpoint - update recipe (management only)
export async function PUT(request, { params }) {
  const { slug } = params;

  // Verify management role via the PIN cookie (same gate as
  // middleware.js uses for other sensitive surfaces — analytics, costing,
  // purchasing, etc.). One cookie, one source of truth.
  const cookieStore = await cookies();
  const pinOk = cookieStore.get('lariat_pin_ok');

  if (pinOk?.value !== '1') {
    return Response.json(
      { error: 'Unauthorized. Management access required.' },
      { status: 403 }
    );
  }

  try {
    const { name, procedures, allergens, ingredients } = await request.json();

    // Validation
    if (!name || !name.trim()) {
      return Response.json(
        { error: 'Recipe name is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(ingredients)) {
      return Response.json(
        { error: 'Ingredients must be an array' },
        { status: 400 }
      );
    }

    // Create audit entry
    const auditEntry = {
      action: 'recipe_edit',
      slug,
      timestamp: new Date().toISOString(),
      changes: {
        name,
        procedures_length: procedures?.length || 0,
        allergens_count: allergens?.length || 0,
        ingredients_count: ingredients.length,
      },
    };

    // Log the audit action
    try {
      logAuditAction(auditEntry);
    } catch (auditError) {
      console.error('Failed to write audit log:', auditError);
      // Continue even if audit logging fails - don't block recipe updates
    }

    // In production, this would:
    // 1. Save to database/audit log ✓ (now implemented)
    // 2. Update the recipe data
    // 3. Return success with updated recipe

    // For now, return success response
    return Response.json({
      success: true,
      slug,
      audit: auditEntry,
      message: 'Recipe updated successfully (persistence not yet implemented)',
    });
  } catch (error) {
    return Response.json(
      { error: `Failed to update recipe: ${error.message}` },
      { status: 500 }
    );
  }
}
