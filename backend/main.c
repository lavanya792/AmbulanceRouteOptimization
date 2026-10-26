#define _POSIX_C_SOURCE 200809L
#include "graph.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#define NODES_FILE "data/nodes.csv"
#define EDGES_FILE "data/edges.csv"
static void print_graph_json(const Graph *g)
{
    printf("{\"success\":true,\"vertices\":%d,\"edges\":%d}\n",
           g->n, g->m);
}
static void print_route_json(
    const Graph *g,
    const PathResult *result,
    int source,
    int destination,
    const char *algorithm)
{
    printf("{");
    printf("\"success\":%s,", result->found ? "true" : "false");
    printf("\"algorithm\":\"%s\",", algorithm);
    printf("\"source\":%d,", source);
    printf("\"destination\":%d,", destination);
    printf("\"found\":%s,", result->found ? "true" : "false");
    printf("\"cost\":%.3f,", result->cost);
    printf("\"distance_m\":%.3f,", result->cost);
    printf("\"explored\":%d,", result->explored);
    printf("\"edge_examinations\":%d,", result->edge_examinations);
    printf("\"successful_relaxations\":%d,",
           result->successful_relaxations);
    printf("\"relaxation_passes\":%d,", result->relaxation_passes);
    printf("\"elapsed_ms\":%.6f,", result->elapsed_ms);
    printf("\"message\":\"%s\",", result->message);
    printf("\"path\":[");
    for (int i = 0; i < result->length; i++)
    {
        int id = result->vertices[i];
        if (i > 0)
            printf(",");
        printf("{\"id\":%d,\"osm_id\":%lld,"
               "\"lat\":%.8f,\"lon\":%.8f}",
               id,
               g->vertices[id].osm_id,
               g->vertices[id].lat,
               g->vertices[id].lon);
    }
    printf("]}\n");
}
static void print_mst_json(
    const Graph *g,
    const Edge *edges,
    int count,
    double total,
    const char *algorithm)
{
    printf("{");
    printf("\"success\":true,");
    printf("\"algorithm\":\"%s\",", algorithm);
    printf("\"scope\":\"whole_graph\",");
    printf("\"edge_count\":%d,", count);
    printf("\"total_weight_m\":%.3f,", total);
    printf("\"edges\":[");
    for (int i = 0; i < count; i++)
    {
        int u = edges[i].from;
        int v = edges[i].to;
        if (i > 0)
            printf(",");
        printf("{\"from\":{\"id\":%d,\"lat\":%.8f,\"lon\":%.8f},",
               u, g->vertices[u].lat, g->vertices[u].lon);
        printf("\"to\":{\"id\":%d,\"lat\":%.8f,\"lon\":%.8f},",
               v, g->vertices[v].lat, g->vertices[v].lon);
        printf("\"weight_m\":%.3f}", edges[i].weight);
    }
    printf("]}\n");
}
static int parse_coordinate(const char *text, double *value)
{
    if (!text || !value)
        return 0;
    char *end = NULL;
    double parsed = strtod(text, &end);
    if (end == text || *end != '\0' || !isfinite(parsed))
        return 0;
    *value = parsed;
    return 1;
}
/*
 * Calculate Prim's or Kruskal's MST on the induced subgraph whose
 * vertices lie inside the selected geographic rectangle.
 *
 * Road edges are treated as undirected by the existing MST functions.
 * Only edges with both endpoints inside the rectangle are included.
 */
static int run_mst_area(
    const Graph *g,
    const char *algorithm,
    double south,
    double west,
    double north,
    double east)
{
    if (!g || !g->vertices ||
        !isfinite(south) || !isfinite(west) ||
        !isfinite(north) || !isfinite(east) ||
        south < -90.0 || north > 90.0 ||
        west < -180.0 || east > 180.0 ||
        south > north || west > east)
    {
        fprintf(stderr, "Invalid geographic rectangle.\n");
        return 0;
    }
    int n = g->n;
    int *old_to_local = malloc((size_t)n * sizeof(int));
    int *local_to_old = malloc((size_t)n * sizeof(int));
    if (!old_to_local || !local_to_old)
    {
        free(old_to_local);
        free(local_to_old);
        fprintf(stderr, "Could not allocate area mappings.\n");
        return 0;
    }
    for (int i = 0; i < n; i++)
        old_to_local[i] = -1;
    int local_n = 0;
    for (int i = 0; i < n; i++)
    {
        double lat = g->vertices[i].lat;
        double lon = g->vertices[i].lon;
        if (lat >= south && lat <= north &&
            lon >= west && lon <= east)
        {
            old_to_local[i] = local_n;
            local_to_old[local_n] = i;
            local_n++;
        }
    }
    if (local_n == 0)
    {
        free(old_to_local);
        free(local_to_old);
        fprintf(stderr,
                "No road nodes found inside the selected area.\n");
        return 0;
    }
    int local_edge_capacity = 0;
    for (int u = 0; u < n; u++)
    {
        if (old_to_local[u] == -1)
            continue;
        for (int e = g->vertices[u].head;
             e != -1;
             e = g->edges[e].next)
        {
            int v = g->edges[e].to;
            if (old_to_local[v] != -1)
                local_edge_capacity++;
        }
    }
    Graph local = {0};
    if (!graph_init(&local, local_n, local_edge_capacity))
    {
        free(old_to_local);
        free(local_to_old);
        fprintf(stderr,
                "Could not initialize the selected-area graph.\n");
        return 0;
    }
    for (int i = 0; i < local_n; i++)
    {
        int original_id = local_to_old[i];
        local.vertices[i].osm_id = g->vertices[original_id].osm_id;
        local.vertices[i].lat = g->vertices[original_id].lat;
        local.vertices[i].lon = g->vertices[original_id].lon;
    }
    for (int u = 0; u < n; u++)
    {
        int local_u = old_to_local[u];
        if (local_u == -1)
            continue;
        for (int e = g->vertices[u].head;
             e != -1;
             e = g->edges[e].next)
        {
            int v = g->edges[e].to;
            int local_v = old_to_local[v];
            if (local_v == -1)
                continue;
            if (!graph_add_edge(
                    &local, local_u, local_v, g->edges[e].weight))
            {
                graph_free(&local);
                free(old_to_local);
                free(local_to_old);
                fprintf(stderr,
                        "Could not construct selected-area graph.\n");
                return 0;
            }
        }
    }
    Edge *local_edges = NULL;
    int count = 0;
    double total = 0.0;
    int ok = 0;
    if (strcmp(algorithm, "prim") == 0)
        ok = prim_mst(&local, &local_edges, &count, &total);
    else if (strcmp(algorithm, "kruskal") == 0)
        ok = kruskal_mst(&local, &local_edges, &count, &total);
    if (!ok)
    {
        free(local_edges);
        graph_free(&local);
        free(old_to_local);
        free(local_to_old);
        fprintf(stderr, "Selected-area MST computation failed.\n");
        return 0;
    }
    printf("{");
    printf("\"success\":true,");
    printf("\"algorithm\":\"%s\",", algorithm);
    printf("\"scope\":\"selected_area\",");
    printf("\"node_count\":%d,", local_n);
    printf("\"edge_count\":%d,", count);
    printf("\"total_weight_m\":%.3f,", total);
    printf("\"edges\":[");
    for (int i = 0; i < count; i++)
    {
        int u = local_to_old[local_edges[i].from];
        int v = local_to_old[local_edges[i].to];
        if (i > 0)
            printf(",");
        printf("{\"from\":{\"id\":%d,\"lat\":%.8f,\"lon\":%.8f},",
               u, g->vertices[u].lat, g->vertices[u].lon);
        printf("\"to\":{\"id\":%d,\"lat\":%.8f,\"lon\":%.8f},",
               v, g->vertices[v].lat, g->vertices[v].lon);
        printf("\"weight_m\":%.3f}", local_edges[i].weight);
    }
    printf("]}\n");
    free(local_edges);
    graph_free(&local);
    free(old_to_local);
    free(local_to_old);
    return 1;
}
int main(int argc, char *argv[])
{
    if (argc < 2)
    {
        fprintf(stderr,
                "Usage:\n"
                "  ambulance_cli graph\n"
                "  ambulance_cli route <algorithm> "
                "<source_lat> <source_lon> "
                "<destination_lat> <destination_lon>\n"
                "  ambulance_cli mst <prim|kruskal>\n"
                "  ambulance_cli mst_area <prim|kruskal> "
                "<south_lat> <west_lon> <north_lat> <east_lon>\n");
        return 1;
    }
    Graph graph = {0};
    if (!graph_load_csv(&graph, NODES_FILE, EDGES_FILE))
    {
        fprintf(stderr, "Error: Could not load road network CSV files.\n");
        graph_free(&graph);
        return 1;
    }
    if (strcmp(argv[1], "graph") == 0 && argc == 2)
    {
        print_graph_json(&graph);
        graph_free(&graph);
        return 0;
    }
    /* Selected-area MST command. */
    if (strcmp(argv[1], "mst_area") == 0 && argc == 7)
    {
        const char *algorithm = argv[2];
        double south, west, north, east;
        if (strcmp(algorithm, "prim") != 0 &&
            strcmp(algorithm, "kruskal") != 0)
        {
            fprintf(stderr,
                    "Unknown MST algorithm. Use prim or kruskal.\n");
            graph_free(&graph);
            return 1;
        }
        if (!parse_coordinate(argv[3], &south) ||
            !parse_coordinate(argv[4], &west) ||
            !parse_coordinate(argv[5], &north) ||
            !parse_coordinate(argv[6], &east))
        {
            fprintf(stderr, "Invalid rectangle coordinates.\n");
            graph_free(&graph);
            return 1;
        }
        int ok = run_mst_area(
            &graph, algorithm, south, west, north, east);
        graph_free(&graph);
        return ok ? 0 : 1;
    }
    /* Existing whole-graph MST command. */
    if (strcmp(argv[1], "mst") == 0 && argc == 3)
    {
        const char *algorithm = argv[2];
        Edge *edges = NULL;
        int count = 0;
        double total = 0.0;
        int ok = 0;
        if (strcmp(algorithm, "prim") == 0)
            ok = prim_mst(&graph, &edges, &count, &total);
        else if (strcmp(algorithm, "kruskal") == 0)
            ok = kruskal_mst(&graph, &edges, &count, &total);
        else
        {
            fprintf(stderr,
                    "Unknown MST algorithm. Use prim or kruskal.\n");
            graph_free(&graph);
            return 1;
        }
        if (!ok)
        {
            fprintf(stderr, "MST computation failed.\n");
            free(edges);
            graph_free(&graph);
            return 1;
        }
        print_mst_json(&graph, edges, count, total, algorithm);
        free(edges);
        graph_free(&graph);
        return 0;
    }
    if (strcmp(argv[1], "route") != 0 || argc != 7)
    {
        fprintf(stderr, "Invalid command or arguments.\n");
        graph_free(&graph);
        return 1;
    }
    const char *algorithm = argv[2];
    double source_lat, source_lon;
    double destination_lat, destination_lon;
    if (!parse_coordinate(argv[3], &source_lat) ||
        !parse_coordinate(argv[4], &source_lon) ||
        !parse_coordinate(argv[5], &destination_lat) ||
        !parse_coordinate(argv[6], &destination_lon))
    {
        fprintf(stderr, "Invalid coordinates.\n");
        graph_free(&graph);
        return 1;
    }
    if (source_lat < -90.0 || source_lat > 90.0 ||
        destination_lat < -90.0 || destination_lat > 90.0 ||
        source_lon < -180.0 || source_lon > 180.0 ||
        destination_lon < -180.0 || destination_lon > 180.0)
    {
        fprintf(stderr, "Coordinates are outside valid ranges.\n");
        graph_free(&graph);
        return 1;
    }
    int source = graph_nearest_vertex(
        &graph, source_lat, source_lon);
    int destination = graph_nearest_vertex(
        &graph, destination_lat, destination_lon);
    if (source < 0 || destination < 0)
    {
        fprintf(stderr,
                "Could not find nearby road intersections.\n");
        graph_free(&graph);
        return 1;
    }
    PathResult result = {0};
    if (strcmp(algorithm, "dijkstra") == 0)
        result = dijkstra(&graph, source, destination);
    else if (strcmp(algorithm, "astar") == 0)
        result = astar(&graph, source, destination);
    else if (strcmp(algorithm, "bellman_ford") == 0)
        result = bellman_ford(&graph, source, destination);
    else
    {
        fprintf(stderr,
                "Unknown routing algorithm. "
                "Use dijkstra, astar, or bellman_ford.\n");
        graph_free(&graph);
        return 1;
    }
    print_route_json(&graph, &result, source, destination, algorithm);
    path_result_free(&result);
    graph_free(&graph);
    return 0;
}