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
               u,
               g->vertices[u].lat,
               g->vertices[u].lon);

        printf("\"to\":{\"id\":%d,\"lat\":%.8f,\"lon\":%.8f},",
               v,
               g->vertices[v].lat,
               g->vertices[v].lon);

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

int main(int argc, char *argv[])
{
    if (argc < 2)
    {
        fprintf(stderr,
                "Usage:\n"
                "  ambulance_cli graph\n"
                "  ambulance_cli route <algorithm> <source_lat> "
                "<source_lon> <destination_lat> <destination_lon>\n"
                "  ambulance_cli mst <prim|kruskal>\n");
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

    /* Minimum spanning tree / spanning forest command. */
    if (strcmp(argv[1], "mst") == 0 && argc == 3)
    {
        const char *algorithm = argv[2];
        Edge *edges = NULL;
        int count = 0;
        double total = 0.0;
        int ok = 0;

        if (strcmp(algorithm, "prim") == 0)
        {
            ok = prim_mst(&graph, &edges, &count, &total);
        }
        else if (strcmp(algorithm, "kruskal") == 0)
        {
            ok = kruskal_mst(&graph, &edges, &count, &total);
        }
        else
        {
            fprintf(stderr, "Unknown MST algorithm. Use prim or kruskal.\n");
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

    int source = graph_nearest_vertex(&graph, source_lat, source_lon);
    int destination = graph_nearest_vertex(
        &graph, destination_lat, destination_lon);

    if (source < 0 || destination < 0)
    {
        fprintf(stderr, "Could not find nearby road intersections.\n");
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
        fprintf(stderr, "Unknown routing algorithm.\n");
        graph_free(&graph);
        return 1;
    }

    print_route_json(&graph, &result, source, destination, algorithm);

    path_result_free(&result);
    graph_free(&graph);
    return 0;
}