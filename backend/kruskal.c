#include "graph.h"

#include <stdlib.h>

/* Edge representation used internally for sorting. */
typedef struct
{
    int from;
    int to;
    double weight;
} MSTEdge;

static int compare_edges(const void *a, const void *b)
{
    const MSTEdge *ea = (const MSTEdge *)a;
    const MSTEdge *eb = (const MSTEdge *)b;

    if (ea->weight < eb->weight)
        return -1;
    if (ea->weight > eb->weight)
        return 1;
    return 0;
}

/* Find a component representative using path compression. */
static int find_root(int parent[], int vertex)
{
    if (parent[vertex] != vertex)
    {
        parent[vertex] = find_root(parent, parent[vertex]);
    }

    return parent[vertex];
}

/* Join two components using union by rank. */
static int union_sets(int parent[], int rank[], int a, int b)
{
    int root_a = find_root(parent, a);
    int root_b = find_root(parent, b);

    if (root_a == root_b)
    {
        return 0;
    }

    if (rank[root_a] < rank[root_b])
    {
        parent[root_a] = root_b;
    }
    else if (rank[root_a] > rank[root_b])
    {
        parent[root_b] = root_a;
    }
    else
    {
        parent[root_b] = root_a;
        rank[root_a]++;
    }

    return 1;
}

/*
 * Kruskal's MST algorithm.
 *
 * The directed road network is treated as an undirected graph
 * for network analysis. Parallel and reverse-direction edges
 * are handled by considering their lowest available weight.
 */
int kruskal_mst(
    const Graph *g,
    Edge **out,
    int *count,
    double *total)
{
    if (!g || !g->vertices || !out || !count || !total)
    {
        return 0;
    }

    *out = NULL;
    *count = 0;
    *total = 0.0;

    int n = g->n;

    if (n <= 0)
    {
        return 1;
    }

    int directed_count = g->edge_count;

    MSTEdge *edges = malloc(
        (size_t)(directed_count > 0 ? directed_count : 1) * sizeof(MSTEdge));

    int *parent = malloc((size_t)n * sizeof(int));
    int *rank = calloc((size_t)n, sizeof(int));
    Edge *mst = malloc((size_t)(n > 1 ? n - 1 : 1) * sizeof(Edge));

    if (!edges || !parent || !rank || !mst)
    {
        free(edges);
        free(parent);
        free(rank);
        free(mst);
        return 0;
    }

    /*
     * Convert directed edges to undirected candidates.
     * Keep only one candidate per unordered vertex pair,
     * using the smallest available weight.
     */
    int unique_count = 0;

    for (int u = 0; u < n; u++)
    {
        for (int e = g->vertices[u].head;
             e != -1;
             e = g->edges[e].next)
        {

            int v = g->edges[e].to;

            if (u == v)
                continue;

            int a = u < v ? u : v;
            int b = u < v ? v : u;
            double weight = g->edges[e].weight;

            int existing = -1;

            for (int i = 0; i < unique_count; i++)
            {
                if (edges[i].from == a && edges[i].to == b)
                {
                    existing = i;
                    break;
                }
            }

            if (existing == -1)
            {
                edges[unique_count].from = a;
                edges[unique_count].to = b;
                edges[unique_count].weight = weight;
                unique_count++;
            }
            else if (weight < edges[existing].weight)
            {
                edges[existing].weight = weight;
            }
        }
    }

    qsort(edges, (size_t)unique_count, sizeof(MSTEdge), compare_edges);

    for (int i = 0; i < n; i++)
    {
        parent[i] = i;
    }

    int selected = 0;

    for (int i = 0; i < unique_count && selected < n - 1; i++)
    {
        MSTEdge edge = edges[i];

        if (union_sets(parent, rank, edge.from, edge.to))
        {
            mst[selected].from = edge.from;
            mst[selected].to = edge.to;
            mst[selected].weight = edge.weight;

            *total += edge.weight;
            selected++;
        }
    }

    free(edges);
    free(parent);
    free(rank);

    *out = mst;
    *count = selected;

    return 1;
}