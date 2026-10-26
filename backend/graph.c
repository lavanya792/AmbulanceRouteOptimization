#define _POSIX_C_SOURCE 200809L

#include "graph.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <limits.h>

#define INITIAL_EDGE_CAPACITY 32768
#define LINE_BUFFER_SIZE 4096
#define PI 3.14159265358979323846

int graph_init(Graph *g, int vertex_count, int edge_capacity)
{
    if (!g || vertex_count <= 0 || edge_capacity < 0)
    {
        fprintf(stderr, "ERROR: Invalid graph initialization parameters.\n");
        return 0;
    }

    memset(g, 0, sizeof(*g));

    g->vertices = calloc((size_t)vertex_count, sizeof(Vertex));

    if (!g->vertices)
    {
        fprintf(stderr, "ERROR: Could not allocate vertices.\n");
        return 0;
    }

    g->n = vertex_count;
    g->edge_capacity = edge_capacity > 0
                           ? edge_capacity
                           : INITIAL_EDGE_CAPACITY;

    g->edges = malloc((size_t)g->edge_capacity * sizeof(AdjEdge));

    if (!g->edges)
    {
        fprintf(stderr, "ERROR: Could not allocate graph edges.\n");
        free(g->vertices);
        memset(g, 0, sizeof(*g));
        return 0;
    }

    for (int i = 0; i < vertex_count; i++)
    {
        g->vertices[i].head = -1;
    }

    return 1;
}

void graph_free(Graph *g)
{
    if (!g)
        return;

    free(g->vertices);
    free(g->edges);
    memset(g, 0, sizeof(*g));
}

int graph_add_edge(Graph *g, int u, int v, double w)
{
    if (!g || !g->vertices ||
        u < 0 || v < 0 ||
        u >= g->n || v >= g->n ||
        u == v || !isfinite(w) || w < 0.0)
    {
        return 0;
    }

    if (g->edge_count >= g->edge_capacity)
    {
        int new_capacity;

        if (g->edge_capacity <= 0)
        {
            new_capacity = INITIAL_EDGE_CAPACITY;
        }
        else
        {
            if (g->edge_capacity > INT_MAX / 2)
                return 0;

            new_capacity = g->edge_capacity * 2;
        }

        AdjEdge *new_edges = realloc(
            g->edges,
            (size_t)new_capacity * sizeof(AdjEdge));

        if (!new_edges)
        {
            fprintf(stderr, "ERROR: Could not expand edge storage.\n");
            return 0;
        }

        g->edges = new_edges;
        g->edge_capacity = new_capacity;
    }

    int index = g->edge_count++;

    g->edges[index].to = v;
    g->edges[index].weight = w;
    g->edges[index].next = g->vertices[u].head;
    g->vertices[u].head = index;

    return 1;
}

int graph_load_csv(
    Graph *g,
    const char *nodes_file,
    const char *edges_file)
{
    if (!g || !nodes_file || !edges_file)
    {
        fprintf(stderr, "ERROR: Invalid CSV loader arguments.\n");
        return 0;
    }

    memset(g, 0, sizeof(*g));

    char line[LINE_BUFFER_SIZE];

    /* PASS 1: Validate nodes and determine graph size. */

    FILE *nodes = fopen(nodes_file, "r");

    if (!nodes)
    {
        perror(nodes_file);
        return 0;
    }

    if (!fgets(line, sizeof(line), nodes))
    {
        fprintf(stderr, "ERROR: Nodes CSV is empty: %s\n", nodes_file);
        fclose(nodes);
        return 0;
    }

    int vertex_count = 0;
    int node_rows = 0;

    while (fgets(line, sizeof(line), nodes))
    {
        long long id, osm_id;
        double lat, lon;

        if (sscanf(line, "%lld,%lld,%lf,%lf",
                   &id, &osm_id, &lat, &lon) != 4)
        {
            fprintf(stderr, "ERROR: Invalid node CSV row %d: %s",
                    node_rows + 2, line);
            fclose(nodes);
            return 0;
        }

        if (id < 0 || id >= INT_MAX ||
            !isfinite(lat) || !isfinite(lon) ||
            lat < -90.0 || lat > 90.0 ||
            lon < -180.0 || lon > 180.0)
        {
            fprintf(stderr, "ERROR: Invalid node data on row %d.\n",
                    node_rows + 2);
            fclose(nodes);
            return 0;
        }

        if ((int)id + 1 > vertex_count)
            vertex_count = (int)id + 1;

        node_rows++;
    }

    fclose(nodes);

    if (vertex_count <= 0 || node_rows <= 0)
    {
        fprintf(stderr, "ERROR: No valid vertices found.\n");
        return 0;
    }

    /* PASS 2: Allocate graph and load node coordinates. */

    if (!graph_init(g, vertex_count, INITIAL_EDGE_CAPACITY))
        return 0;

    nodes = fopen(nodes_file, "r");

    if (!nodes)
    {
        perror(nodes_file);
        graph_free(g);
        return 0;
    }

    if (!fgets(line, sizeof(line), nodes))
    {
        fprintf(stderr, "ERROR: Could not read nodes CSV header.\n");
        fclose(nodes);
        graph_free(g);
        return 0;
    }

    int loaded_nodes = 0;

    while (fgets(line, sizeof(line), nodes))
    {
        long long id, osm_id;
        double lat, lon;

        if (sscanf(line, "%lld,%lld,%lf,%lf",
                   &id, &osm_id, &lat, &lon) != 4 ||
            id < 0 || id >= g->n ||
            !isfinite(lat) || !isfinite(lon) ||
            lat < -90.0 || lat > 90.0 ||
            lon < -180.0 || lon > 180.0)
        {
            fprintf(stderr, "ERROR: Could not load node row %d.\n",
                    loaded_nodes + 2);
            fclose(nodes);
            graph_free(g);
            return 0;
        }

        g->vertices[id].osm_id = osm_id;
        g->vertices[id].lat = lat;
        g->vertices[id].lon = lon;
        loaded_nodes++;
    }

    fclose(nodes);

    if (loaded_nodes != vertex_count)
    {
        fprintf(stderr,
                "ERROR: Expected %d node rows but loaded %d. "
                "Check whether node IDs are contiguous from zero.\n",
                vertex_count, loaded_nodes);

        graph_free(g);
        return 0;
    }

    /* PASS 3: Load road edges, skipping self-loops. */

    FILE *edges = fopen(edges_file, "r");

    if (!edges)
    {
        perror(edges_file);
        graph_free(g);
        return 0;
    }

    if (!fgets(line, sizeof(line), edges))
    {
        fprintf(stderr, "ERROR: Edges CSV is empty: %s\n", edges_file);
        fclose(edges);
        graph_free(g);
        return 0;
    }

    int edge_rows = 0;
    int skipped_self_loops = 0;

    while (fgets(line, sizeof(line), edges))
    {
        int u, v;
        double weight;

        if (sscanf(line, "%d,%d,%lf", &u, &v, &weight) != 3)
        {
            fprintf(stderr, "ERROR: Invalid edge CSV row %d: %s",
                    edge_rows + skipped_self_loops + 2, line);
            fclose(edges);
            graph_free(g);
            return 0;
        }

        int csv_row = edge_rows + skipped_self_loops + 2;

        if (u < 0 || v < 0 ||
            u >= g->n || v >= g->n ||
            !isfinite(weight) || weight < 0.0)
        {
            fprintf(stderr, "ERROR: Invalid edge values on row %d.\n",
                    csv_row);
            fclose(edges);
            graph_free(g);
            return 0;
        }

        /*
         * Self-loops do not improve shortest paths.
         * Skip them rather than treating them as fatal errors.
         */
        if (u == v)
        {
            skipped_self_loops++;
            continue;
        }

        if (!graph_add_edge(g, u, v, weight))
        {
            fprintf(stderr, "ERROR: Could not add edge on row %d.\n",
                    csv_row);
            fclose(edges);
            graph_free(g);
            return 0;
        }

        edge_rows++;
        g->m++;
    }

    fclose(edges);

    if (edge_rows == 0)
    {
        fprintf(stderr, "ERROR: No valid road edges loaded.\n");
        graph_free(g);
        return 0;
    }

    fprintf(stderr,
            "Road graph loaded successfully: %d vertices, "
            "%d directed edges; skipped %d self-loops.\n",
            g->n, g->edge_count, skipped_self_loops);

    return 1;
}

int graph_nearest_vertex(
    const Graph *g,
    double lat,
    double lon)
{
    if (!g || !g->vertices || g->n <= 0 ||
        !isfinite(lat) || !isfinite(lon) ||
        lat < -90.0 || lat > 90.0 ||
        lon < -180.0 || lon > 180.0)
    {
        return -1;
    }

    int nearest = -1;
    double best_distance = INFINITY;

    double latitude_radians = lat * PI / 180.0;
    double longitude_scale = cos(latitude_radians);

    for (int i = 0; i < g->n; i++)
    {
        double dlat = g->vertices[i].lat - lat;
        double dlon = g->vertices[i].lon - lon;

        double x = dlon * longitude_scale;
        double distance = x * x + dlat * dlat;

        if (distance < best_distance)
        {
            best_distance = distance;
            nearest = i;
        }
    }

    return nearest;
}

void path_result_free(PathResult *result)
{
    if (!result)
        return;

    free(result->vertices);
    memset(result, 0, sizeof(*result));
}