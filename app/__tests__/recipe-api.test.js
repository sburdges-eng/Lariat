describe('Recipe API Endpoints', () => {
  describe('PUT /api/recipes/[slug]', () => {
    test('should reject request without management cookie', async () => {
      const response = await fetch('/api/recipes/test-recipe', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 
          name: 'Updated Recipe',
          ingredients: [],
          procedures: [],
          allergens: []
        }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('Unauthorized');
    });

    test('should reject request with invalid management cookie', async () => {
      // Simulate invalid cookie by not setting it to 'authenticated'
      const response = await fetch('/api/recipes/test-recipe', {
        method: 'PUT',
        headers: { 
          'content-type': 'application/json',
          'cookie': 'lariat_pin_ok=0'
        },
        body: JSON.stringify({ 
          name: 'Updated Recipe',
          ingredients: [],
          procedures: [],
          allergens: []
        }),
      });

      expect(response.status).toBe(403);
    });

    test('should validate required recipe name', async () => {
      const response = await fetch('/api/recipes/test-recipe', {
        method: 'PUT',
        headers: { 
          'content-type': 'application/json',
          'cookie': 'lariat_pin_ok=1'
        },
        body: JSON.stringify({ 
          name: '',
          ingredients: [],
          procedures: [],
          allergens: []
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Recipe name is required');
    });

    test('should validate ingredients is array', async () => {
      const response = await fetch('/api/recipes/test-recipe', {
        method: 'PUT',
        headers: { 
          'content-type': 'application/json',
          'cookie': 'lariat_pin_ok=1'
        },
        body: JSON.stringify({ 
          name: 'Test Recipe',
          ingredients: 'not an array',
          procedures: [],
          allergens: []
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Ingredients must be an array');
    });

    test('should return audit entry on successful update', async () => {
      const response = await fetch('/api/recipes/test-recipe', {
        method: 'PUT',
        headers: { 
          'content-type': 'application/json',
          'cookie': 'lariat_pin_ok=1'
        },
        body: JSON.stringify({ 
          name: 'Test Recipe',
          ingredients: [{ item: 'Flour', quantity: '2', unit: 'cups' }],
          procedures: ['Step 1', 'Step 2'],
          allergens: ['Gluten']
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.audit).toBeDefined();
      expect(data.audit.action).toBe('recipe_edit');
      expect(data.audit.slug).toBe('test-recipe');
      expect(data.audit.timestamp).toBeDefined();
      expect(data.audit.changes).toEqual({
        name: 'Test Recipe',
        procedures_length: 2,
        allergens_count: 1,
        ingredients_count: 1
      });
    });

    test('should handle malformed JSON gracefully', async () => {
      const response = await fetch('/api/recipes/test-recipe', {
        method: 'PUT',
        headers: { 
          'content-type': 'application/json',
          'cookie': 'lariat_pin_ok=1'
        },
        body: 'invalid json {',
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('GET /api/recipes/[slug]', () => {
    test('should return success message for recipe fetch', async () => {
      const response = await fetch('/api/recipes/test-recipe');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.slug).toBe('test-recipe');
    });

    test('should not require authentication for GET', async () => {
      const response = await fetch('/api/recipes/test-recipe');
      expect(response.status).toBe(200);
    });
  });
});
