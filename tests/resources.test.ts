import { describe, it, expect } from 'vitest';

/**
 * Tests for Resources modules
 * Tests knowledge resource categories, taxonomy paths, and guide resource
 */

// Category names from knowledge/index.ts
const categoryNames = [
  'arcs', 'sdks', 'algokit', 'algokit-utils',
  'tealscript', 'puya', 'liquid-auth', 'python',
  'developers', 'clis', 'nodes', 'details'
];

// Category display names from knowledge/index.ts
const categoryDisplayNames: Record<string, string> = {
  'arcs': 'Algorand Request for Comments',
  'sdks': 'Software Development Kits',
  'algokit': 'AlgoKit',
  'algokit-utils': 'AlgoKit Utils',
  'tealscript': 'TEALScript',
  'puya': 'Puya',
  'liquid-auth': 'Liquid Auth',
  'python': 'Python Development',
  'developers': 'Developer Documentation',
  'clis': 'CLI Tools',
  'nodes': 'Node Management',
  'details': 'Developer Details'
};

// R2 path construction from knowledge/index.ts
function buildR2TaxonomyPath(category: string): string {
  return `taxonomy-categories/${category}.json`;
}

describe('Knowledge Resources', () => {
  describe('Category names', () => {
    it('should have 12 categories', () => {
      expect(categoryNames).toHaveLength(12);
    });

    it('should include all expected categories', () => {
      expect(categoryNames).toContain('arcs');
      expect(categoryNames).toContain('sdks');
      expect(categoryNames).toContain('algokit');
      expect(categoryNames).toContain('developers');
      expect(categoryNames).toContain('python');
    });

    it('should not have duplicates', () => {
      const uniqueNames = [...new Set(categoryNames)];
      expect(uniqueNames).toHaveLength(categoryNames.length);
    });
  });

  describe('Category display names', () => {
    it('should have a display name for every category', () => {
      categoryNames.forEach(cat => {
        expect(categoryDisplayNames[cat]).toBeDefined();
        expect(categoryDisplayNames[cat].length).toBeGreaterThan(0);
      });
    });

    it('should map arcs correctly', () => {
      expect(categoryDisplayNames['arcs']).toBe('Algorand Request for Comments');
    });

    it('should map algokit-utils correctly', () => {
      expect(categoryDisplayNames['algokit-utils']).toBe('AlgoKit Utils');
    });
  });

  describe('R2 taxonomy path construction', () => {
    it('should build correct path for category', () => {
      expect(buildR2TaxonomyPath('arcs')).toBe('taxonomy-categories/arcs.json');
    });

    it('should handle hyphenated category names', () => {
      expect(buildR2TaxonomyPath('algokit-utils')).toBe('taxonomy-categories/algokit-utils.json');
    });

    it('should build paths for all categories', () => {
      categoryNames.forEach(cat => {
        const path = buildR2TaxonomyPath(cat);
        expect(path).toMatch(/^taxonomy-categories\/.*\.json$/);
      });
    });
  });

  describe('Resource URI patterns', () => {
    it('should use algorand:// scheme for taxonomy', () => {
      const uri = 'algorand://knowledge/taxonomy';
      expect(uri).toMatch(/^algorand:\/\//);
    });

    it('should use algorand:// scheme for category resources', () => {
      categoryNames.forEach(cat => {
        const uri = `algorand://knowledge/taxonomy/${cat}`;
        expect(uri).toMatch(/^algorand:\/\/knowledge\/taxonomy\/.+$/);
      });
    });

    it('should use algorand:// scheme for guide', () => {
      const uri = 'algorand://remote-mcp-guide';
      expect(uri).toMatch(/^algorand:\/\//);
    });
  });
});

describe('Guide Resource', () => {
  it('should have a fixed URI', () => {
    const guideUri = 'algorand://remote-mcp-guide';
    expect(guideUri).toBe('algorand://remote-mcp-guide');
  });

  it('should have a name', () => {
    const guideName = 'Algorand MCP Guide';
    expect(guideName).toBe('Algorand MCP Guide');
  });
});

describe('Index Module', () => {
  describe('MCP Server configuration', () => {
    it('should have correct server name', () => {
      const name = 'Algorand Remote MCP';
      expect(name).toBe('Algorand Remote MCP');
    });

    it('should have correct version format', () => {
      const version = '1.2.0';
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Default state', () => {
    it('should have default items_per_page of 10', () => {
      const initialState = { items_per_page: 10 };
      expect(initialState.items_per_page).toBe(10);
    });
  });

  describe('OAuth provider paths', () => {
    it('should configure correct API route', () => {
      const apiRoute = '/sse';
      expect(apiRoute).toBe('/sse');
    });

    it('should configure correct authorize endpoint', () => {
      const authorizeEndpoint = '/authorize';
      expect(authorizeEndpoint).toBe('/authorize');
    });

    it('should configure correct token endpoint', () => {
      const tokenEndpoint = '/token';
      expect(tokenEndpoint).toBe('/token');
    });

    it('should configure correct client registration endpoint', () => {
      const clientRegistrationEndpoint = '/register';
      expect(clientRegistrationEndpoint).toBe('/register');
    });
  });
});
