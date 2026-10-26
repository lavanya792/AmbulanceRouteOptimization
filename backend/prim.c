#include "graph.h"

#include <stdlib.h>
#include <float.h>

/*
 * Prim's Minimum Spanning Tree algorithm.
 *
 * Treats the road network as an undirected graph for MST analysis.
 * The routing algorithms should continue using directed road edges.
 */
int prim_mst(
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
        return 1;

    unsigned char *in_mst = calloc((size_t)n, sizeof(unsigned char));
    double *key = malloc((size_t)n * sizeof(double));
    int *parent = malloc((size_t)n * sizeof(int));
    Edge *mst = malloc((size_t)(n - 1) * sizeof(Edge));

    if (!in_mst || !key || !parent || (n > 1 && !mst))
    {
        free(in_mst);
        free(key);
        free(parent);
        free(mst);
        return 0;
    }

    for (int i = 0; i < n; i++)
    {
        key[i] = DBL_MAX;
        parent[i] = -1;
    }

    key[0] = 0.0;

    int edge_count = 0;

    for (int step = 0; step < n; step++)
    {
        int u = -1;
        double minimum = DBL_MAX;

        /* Select the cheapest vertex not yet included. */
        for (int v = 0; v < n; v++)
        {
            if (!in_mst[v] && key[v] < minimum)
            {
                minimum = key[v];
                u = v;
            }
        }

        /*
         * If the remaining vertices are disconnected,
         * start another component to build a spanning forest.
         */
        if (u == -1)
        {
            for (int v = 0; v < n; v++)
            {
                if (!in_mst[v])
                {
                    u = v;
                    key[v] = 0.0;
                    parent[v] = -1;
                    break;
                }
            }
        }

        if (u == -1)
            break;

        in_mst[u] = 1;

        if (parent[u] != -1)
        {
            mst[edge_count].from = parent[u];
            mst[edge_count].to = u;
            mst[edge_count].weight = key[u];

            *total += key[u];
            edge_count++;
        }

        /* Consider each outgoing road as an undirected MST connection. */
        for (int e = g->vertices[u].head;
             e != -1;
             e = g->edges[e].next)
        {

            int v = g->edges[e].to;
            double weight = g->edges[e].weight;

            if (v != u && !in_mst[v] && weight < key[v])
            {
                key[v] = weight;
                parent[v] = u;
            }
        }

        /*
         * Also inspect incoming edges, because the directed road graph
         * is being treated as undirected for MST analysis.
         */
        for (int v = 0; v < n; v++)
        {
            for (int e = g->vertices[v].head;
                 e != -1;
                 e = g->edges[e].next)
            {

                if (g->edges[e].to == u &&
                    v != u &&
                    !in_mst[v] &&
                    g->edges[e].weight < key[v])
                {

                    key[v] = g->edges[e].weight;
                    parent[v] = u;
                }
            }
        }
    }

    free(in_mst);
    free(key);
    free(parent);

    *out = mst;
    *count = edge_count;

    return 1;
}